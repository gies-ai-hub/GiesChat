import { logger } from '@librechat/data-schemas';
import { DefaultAzureCredential } from '@azure/identity';
import { FileSources } from 'librechat-data-provider';
import type { ContainerClient, BlobServiceClient, BlockBlobClient } from '@azure/storage-blob';
import type { TFile } from 'librechat-data-provider';
import type { BatchUpdateFn } from '~/storage/types';

let blobServiceClient: BlobServiceClient | null = null;
let azureWarningLogged = false;

const DAY_SECONDS = 24 * 60 * 60;
const DEFAULT_DOCUMENT_SAS_SECONDS = 7 * DAY_SECONDS;
/* ponytail: chat images and avatars are copied into message and user records that nothing
 * re-signs, so they get a year; documents get the short window and are re-signed on the
 * /files listing. Upgrade path: serve images through the app like the S3 inline paths. */
const IMAGE_SAS_SECONDS = 365 * DAY_SECONDS;
export const AZURE_IMAGES_BASE_PATH = 'images';

export function isAzurePublicAccess(): boolean {
  return (process.env.AZURE_STORAGE_PUBLIC_ACCESS ?? 'true').toLowerCase() === 'true';
}

function documentSasSeconds(): number {
  const parsed = parseInt(process.env.AZURE_SAS_EXPIRY_SECONDS ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DOCUMENT_SAS_SECONDS;
}

/**
 * The URL stored for a blob. Public containers get the plain blob URL; private ones get a
 * read-only SAS link signed with the account key from the connection string.
 */
export async function getAzureBlobUrl(
  blockBlobClient: BlockBlobClient,
  basePath?: string,
): Promise<string> {
  if (isAzurePublicAccess()) {
    return blockBlobClient.url;
  }
  const { BlobSASPermissions } = await import('@azure/storage-blob');
  const seconds = basePath === AZURE_IMAGES_BASE_PATH ? IMAGE_SAS_SECONDS : documentSasSeconds();
  return blockBlobClient.generateSasUrl({
    permissions: BlobSASPermissions.parse('r'),
    expiresOn: new Date(Date.now() + seconds * 1000),
  });
}

export function parseAzureBlobUrl(
  fileURL: string,
): { containerName: string; blobPath: string } | null {
  try {
    const [containerName, ...rest] = new URL(fileURL).pathname.replace(/^\//, '').split('/');
    if (!containerName || rest.length === 0) {
      return null;
    }
    return { containerName, blobPath: decodeURIComponent(rest.join('/')) };
  } catch {
    return null;
  }
}

export function azureSasExpiresAt(fileURL: string): number | null {
  try {
    const expiry = new URL(fileURL).searchParams.get('se');
    const time = expiry ? Date.parse(expiry) : NaN;
    return Number.isFinite(time) ? time : null;
  } catch {
    return null;
  }
}

/** A private-container URL without a SAS (e.g. stored before the switch) also needs signing. */
export function azureUrlNeedsRefresh(fileURL: string, bufferSeconds = 3600): boolean {
  if (isAzurePublicAccess()) {
    return false;
  }
  const expiresAt = azureSasExpiresAt(fileURL);
  return expiresAt == null || expiresAt - Date.now() < bufferSeconds * 1000;
}

export async function refreshAzureUrl(
  file: { source?: string; filepath?: string } | null | undefined,
  bufferSeconds = 3600,
): Promise<string> {
  const filepath = file?.filepath ?? '';
  if (file?.source !== FileSources.azure_blob || !filepath) {
    return filepath;
  }
  if (!azureUrlNeedsRefresh(filepath, bufferSeconds)) {
    return filepath;
  }
  const parsed = parseAzureBlobUrl(filepath);
  if (!parsed) {
    return filepath;
  }
  try {
    const containerClient = await getAzureContainerClient(parsed.containerName);
    if (!containerClient) {
      return filepath;
    }
    const basePath = parsed.blobPath.split('/')[0];
    return await getAzureBlobUrl(containerClient.getBlockBlobClient(parsed.blobPath), basePath);
  } catch (error) {
    logger.error('[refreshAzureUrl] Error re-signing blob URL:', error);
    return filepath;
  }
}

export async function refreshAzureFileUrls(
  files: TFile[] | null | undefined,
  batchUpdateFiles: BatchUpdateFn,
  bufferSeconds = 3600,
): Promise<TFile[]> {
  if (!files?.length) {
    return [];
  }
  const updates: Array<{ file_id: string; filepath: string }> = [];
  const refreshed = await Promise.all(
    files.map(async (file) => {
      if (!file?.file_id || file.source !== FileSources.azure_blob || !file.filepath) {
        return file;
      }
      const filepath = await refreshAzureUrl(file, bufferSeconds);
      if (filepath === file.filepath) {
        return file;
      }
      updates.push({ file_id: file.file_id, filepath });
      return { ...file, filepath };
    }),
  );
  if (updates.length > 0) {
    await batchUpdateFiles(updates);
  }
  return refreshed;
}

/** Reads through the SDK so a private container works; the URL's SAS, if any, is ignored. */
export async function getAzureBlobStream(fileURL: string): Promise<NodeJS.ReadableStream> {
  const parsed = parseAzureBlobUrl(fileURL);
  if (!parsed) {
    throw new Error(`[getAzureBlobStream] Not an Azure blob URL: ${fileURL}`);
  }
  const containerClient = await getAzureContainerClient(parsed.containerName);
  if (!containerClient) {
    throw new Error('[getAzureBlobStream] Azure Blob Service not initialized');
  }
  const response = await containerClient.getBlockBlobClient(parsed.blobPath).download();
  if (!response.readableStreamBody) {
    throw new Error(`[getAzureBlobStream] Empty response body for ${parsed.blobPath}`);
  }
  return response.readableStreamBody;
}

/**
 * Initializes the Azure Blob Service client.
 * This function establishes a connection by checking if a connection string is provided.
 * If available, the connection string is used; otherwise, Managed Identity (via DefaultAzureCredential) is utilized.
 * Note: Container creation (and its public access settings) is handled later in the CRUD functions.
 * @returns The initialized client, or null if the required configuration is missing.
 */
export const initializeAzureBlobService = async (): Promise<BlobServiceClient | null> => {
  if (blobServiceClient) {
    return blobServiceClient;
  }
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (connectionString) {
    const { BlobServiceClient } = await import('@azure/storage-blob');
    blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    logger.info('Azure Blob Service initialized using connection string');
  } else {
    const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
    if (!accountName) {
      if (!azureWarningLogged) {
        logger.error(
          '[initializeAzureBlobService] Azure Blob Service not initialized. Connection string missing and AZURE_STORAGE_ACCOUNT_NAME not provided.',
        );
        azureWarningLogged = true;
      }
      return null;
    }
    const url = `https://${accountName}.blob.core.windows.net`;
    const credential = new DefaultAzureCredential();
    const { BlobServiceClient } = await import('@azure/storage-blob');
    blobServiceClient = new BlobServiceClient(url, credential);
    logger.info('Azure Blob Service initialized using Managed Identity');
  }
  return blobServiceClient;
};

/**
 * Retrieves the Azure ContainerClient for the given container name.
 * @param [containerName=process.env.AZURE_CONTAINER_NAME || 'files'] - The container name.
 * @returns The Azure ContainerClient.
 */
export const getAzureContainerClient = async (
  containerName: string = process.env.AZURE_CONTAINER_NAME || 'files',
): Promise<ContainerClient | null> => {
  const serviceClient = await initializeAzureBlobService();
  return serviceClient ? serviceClient.getContainerClient(containerName) : null;
};
