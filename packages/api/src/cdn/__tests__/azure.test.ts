import { FileSources } from 'librechat-data-provider';
import type { TFile } from 'librechat-data-provider';
import {
  parseAzureBlobUrl,
  azureSasExpiresAt,
  refreshAzureFileUrls,
  azureUrlNeedsRefresh,
} from '../azure';

const plain = 'https://stgieschat.blob.core.windows.net/files/images/user1/a%20b.pdf';
const signed = (expiresAt: Date) =>
  `${plain}?sv=2024-11-04&se=${encodeURIComponent(expiresAt.toISOString())}&sr=b&sp=r&sig=abc`;

describe('azure blob url helpers', () => {
  const original = process.env.AZURE_STORAGE_PUBLIC_ACCESS;
  afterEach(() => {
    process.env.AZURE_STORAGE_PUBLIC_ACCESS = original;
  });

  it('parses container and decoded blob path, ignoring the SAS query', () => {
    expect(parseAzureBlobUrl(signed(new Date()))).toEqual({
      containerName: 'files',
      blobPath: 'images/user1/a b.pdf',
    });
    expect(parseAzureBlobUrl('https://stgieschat.blob.core.windows.net/files')).toBeNull();
    expect(parseAzureBlobUrl('not a url')).toBeNull();
  });

  it('reads the SAS expiry', () => {
    const expiresAt = new Date('2026-09-21T00:00:00.000Z');
    expect(azureSasExpiresAt(signed(expiresAt))).toBe(expiresAt.getTime());
    expect(azureSasExpiresAt(plain)).toBeNull();
  });

  it('needs a refresh when private and unsigned, expiring, or expired', () => {
    process.env.AZURE_STORAGE_PUBLIC_ACCESS = 'false';
    expect(azureUrlNeedsRefresh(plain)).toBe(true);
    expect(azureUrlNeedsRefresh(signed(new Date(Date.now() + 60_000)))).toBe(true);
    expect(azureUrlNeedsRefresh(signed(new Date(Date.now() - 60_000)))).toBe(true);
    expect(azureUrlNeedsRefresh(signed(new Date(Date.now() + 2 * 3600_000)))).toBe(false);
  });

  it('never refreshes public containers', () => {
    process.env.AZURE_STORAGE_PUBLIC_ACCESS = 'true';
    expect(azureUrlNeedsRefresh(plain)).toBe(false);
  });

  it('skips non-azure and fresh files without touching the database', async () => {
    process.env.AZURE_STORAGE_PUBLIC_ACCESS = 'false';
    const batchUpdateFiles = jest.fn();
    const fresh = signed(new Date(Date.now() + 2 * 3600_000));
    const files = [
      { file_id: '1', source: FileSources.local, filepath: '/uploads/x.pdf' },
      { file_id: '2', source: FileSources.azure_blob, filepath: fresh },
    ] as TFile[];
    const result = await refreshAzureFileUrls(files, batchUpdateFiles);
    expect(result).toEqual(files);
    expect(batchUpdateFiles).not.toHaveBeenCalled();
  });
});
