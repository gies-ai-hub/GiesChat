import { Types } from 'mongoose';
import { createHash, randomUUID } from 'crypto';
import { logger } from '@librechat/data-schemas';
import { EToolResources, FileContext, FileSources } from 'librechat-data-provider';
import type { AdminWebsiteItem, WebsitePage } from 'librechat-data-provider';
import type { IMongoFile } from '@librechat/data-schemas';
import type { ModelTestEndpoint } from '~/admin/modelTest';
import type { CrawlResult } from './crawl';
import { cleanPages } from './extract';

export interface SiteStoreDeps {
  /** Indexes the text in the RAG API under the agent; `false` when it could not (copy stays inline-only). */
  indexText: (params: {
    userId: string;
    fileId: string;
    filename: string;
    text: string;
    agentId: string;
  }) => Promise<boolean>;
  createFile: (data: Partial<IMongoFile>, disableTTL?: boolean) => Promise<IMongoFile | null>;
  addAgentResourceFile: (params: {
    agent_id: string;
    tool_resource: string;
    file_id: string;
    updatingUserId?: string;
    skipVersioning?: boolean;
  }) => Promise<unknown>;
  removeAgentResourceFiles: (params: {
    agent_id: string;
    files: Array<{ tool_resource: string; file_id: string }>;
  }) => Promise<unknown>;
  /** Agents (by `id`) whose documents include this file. */
  findAgentsUsingFile: (fileId: string) => Promise<Array<{ id: string }>>;
  deleteVectors: (params: { userId: string; file: IMongoFile }) => Promise<void>;
  deleteFiles: (fileIds: string[]) => Promise<unknown>;
  resolveEndpoint: () => Promise<ModelTestEndpoint | null>;
}

/** Hash of the crawled plain text (before Luna), so an unchanged site is spotted without a model call. */
export function contentHash(pages: WebsitePage[]): string {
  const hash = createHash('sha256');
  [...pages]
    .sort((a, b) => a.url.localeCompare(b.url))
    .forEach((page) => hash.update(`${page.url}\n${page.text}\n`));
  return hash.digest('hex');
}

export const siteDocument = (pages: WebsitePage[]): string =>
  pages.map((page) => `## ${page.title} (${page.url})\n\n${page.text}`).join('\n\n');

export function siteFilename(url: string): string {
  const { host, pathname } = new URL(url);
  return `Website · ${host}${pathname.replace(/\/$/, '')}`;
}

export function toWebsiteItem(file: IMongoFile): AdminWebsiteItem {
  const { sourceUrl = '', pages = 0, checkedAt } = file.metadata ?? {};
  return {
    file_id: file.file_id,
    url: sourceUrl,
    pages,
    checkedAt: new Date(checkedAt ?? Date.now()).toISOString(),
  };
}

/**
 * Luna cleans the crawled pages and the result becomes one context document on the agent.
 * `versioned: false` (the nightly refresh) attaches it without an agent version, so a
 * changing site does not mark every open draft "production has changed".
 */
export async function saveSiteCopy(
  deps: SiteStoreDeps,
  params: { userId: string; agentId: string; crawl: CrawlResult; now?: Date; versioned?: boolean },
): Promise<IMongoFile> {
  const { userId, agentId, crawl, now = new Date(), versioned = true } = params;
  const cleaned = await cleanPages(crawl.pages, await deps.resolveEndpoint());
  const text = siteDocument(cleaned);
  const fileId = randomUUID();
  const filename = siteFilename(crawl.url);
  const embedded = await deps
    .indexText({ userId, fileId, filename, text, agentId })
    .catch((error: unknown) => {
      logger.warn(`[sites] could not index ${crawl.url}; the copy stays inline-only`, error);
      return false;
    });
  const file = await deps.createFile(
    {
      user: new Types.ObjectId(userId),
      file_id: fileId,
      filename,
      /* Never the site address: download routes read local files by `filepath`. */
      filepath: FileSources.text,
      type: 'text/plain',
      bytes: Buffer.byteLength(text, 'utf8'),
      text,
      source: FileSources.text,
      context: FileContext.agents,
      embedded,
      usage: 0,
      metadata: {
        sourceUrl: crawl.url,
        pages: crawl.pages.length,
        contentHash: contentHash(crawl.pages),
        checkedAt: now,
      },
    },
    true,
  );
  if (!file) {
    throw new Error(`Could not save the copy of ${crawl.url}`);
  }
  await deps.addAgentResourceFile({
    agent_id: agentId,
    tool_resource: EToolResources.context,
    file_id: fileId,
    updatingUserId: userId,
    skipVersioning: !versioned,
  });
  return file;
}

/** Deletes a copy and its search entries; callers make sure no agent still uses it. */
export async function dropCopy(
  deps: SiteStoreDeps,
  params: { file: IMongoFile; userId: string },
): Promise<void> {
  const { file, userId } = params;
  await deps.deleteVectors({ userId, file }).catch((error: unknown) => {
    logger.warn(`[sites] could not remove search entries for ${file.file_id}`, error);
  });
  await deps.deleteFiles([file.file_id]);
}

/** Detaches a copy from one agent, then deletes it once no agent uses it (a draft may share it). */
export async function retireCopy(
  deps: SiteStoreDeps,
  params: { agentId: string; file: IMongoFile; userId: string },
): Promise<void> {
  const { agentId, file, userId } = params;
  await deps.removeAgentResourceFiles({
    agent_id: agentId,
    files: [{ tool_resource: EToolResources.context, file_id: file.file_id }],
  });
  if ((await deps.findAgentsUsingFile(file.file_id)).length > 0) {
    return;
  }
  await dropCopy(deps, { file, userId });
}

/** The new copy is saved and attached before the old ones go, so the agent is never without one. */
export async function replaceSiteCopy(
  deps: SiteStoreDeps,
  params: { userId: string; agentId: string; crawl: CrawlResult; previous: IMongoFile[] },
): Promise<IMongoFile> {
  const file = await saveSiteCopy(deps, params);
  for (const old of params.previous) {
    await retireCopy(deps, { agentId: params.agentId, file: old, userId: params.userId });
  }
  return file;
}
