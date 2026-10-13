import { logger, runAsSystem } from '@librechat/data-schemas';
import type { IMongoFile } from '@librechat/data-schemas';
import type { SiteStoreDeps } from './store';
import type { CrawlResult } from './crawl';
import { dropCopy, contentHash, retireCopy, saveSiteCopy } from './store';
import { isLeader } from '~/cluster';

const DUE_AFTER_MS = 24 * 60 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;
/** ponytail: a dead site is retried every run; >50 dead sites would starve the rest, add a failedAt backoff then. */
const BATCH = 50;

export interface RefreshDeps extends SiteStoreDeps {
  getDueWebsiteCopies: (before: Date, limit?: number) => Promise<IMongoFile[]>;
  markWebsiteChecked: (fileId: string, checkedAt: Date) => Promise<void>;
  crawl: (url: string) => Promise<CrawlResult>;
}

export interface RefreshSummary {
  checked: number;
  updated: number;
  failed: number;
  /** Copies no agent uses any more (removed in the builder, or the agent was deleted). */
  dropped: number;
}

/**
 * One pass over copies not checked for a day. A copy no agent uses is deleted without a
 * crawl (the builder's Remove only detaches it). Unchanged text only stamps `checkedAt`;
 * changed text gets Luna and a new copy for every agent using the old one. A failure
 * keeps the old copy and leaves it due, so the next run tries again.
 */
export async function refreshDueSites(
  deps: RefreshDeps,
  now: Date = new Date(),
): Promise<RefreshSummary> {
  const due = await deps.getDueWebsiteCopies(new Date(now.getTime() - DUE_AFTER_MS), BATCH);
  const summary: RefreshSummary = { checked: 0, updated: 0, failed: 0, dropped: 0 };
  for (const file of due) {
    const url = file.metadata?.sourceUrl;
    if (!url) {
      continue;
    }
    try {
      const userId = String(file.user);
      const agents = await deps.findAgentsUsingFile(file.file_id);
      if (agents.length === 0) {
        await dropCopy(deps, { file, userId });
        summary.dropped += 1;
        continue;
      }
      const crawl = await deps.crawl(url);
      if (crawl.pages.length === 0) {
        throw new Error('no readable pages');
      }
      const lostPages =
        crawl.pages.length < (file.metadata?.pages ?? 0) &&
        crawl.skipped.some((item) => item.reason === 'error');
      if (lostPages) {
        /* Pages that failed to load tonight would shrink a good copy; keep it and look again tomorrow. */
        await deps.markWebsiteChecked(file.file_id, now);
        summary.failed += 1;
        logger.warn(`[sites] ${url}: some pages failed to load; keeping the fuller copy`);
        continue;
      }
      if (contentHash(crawl.pages) === file.metadata?.contentHash) {
        await deps.markWebsiteChecked(file.file_id, now);
        summary.checked += 1;
        continue;
      }
      for (const agent of agents) {
        await saveSiteCopy(deps, { userId, agentId: agent.id, crawl, now, versioned: false });
        await retireCopy(deps, { agentId: agent.id, file, userId });
      }
      summary.updated += 1;
    } catch (error) {
      summary.failed += 1;
      logger.warn(`[sites] refresh of ${url} failed; keeping the existing copy`, error);
    }
  }
  return summary;
}

/** Hourly, leader only, never overlapping. `WEBSITE_REFRESH_INTERVAL_MS=0` turns it off. */
export function startSiteRefresh(deps: RefreshDeps): NodeJS.Timeout | null {
  const intervalMs = Number(process.env.WEBSITE_REFRESH_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
  if (!intervalMs) {
    logger.info('[sites] Website refresh disabled by WEBSITE_REFRESH_INTERVAL_MS=0');
    return null;
  }
  let running = false;
  const run = async () => {
    if (running || !(await isLeader())) {
      return;
    }
    running = true;
    try {
      const summary = await runAsSystem(() => refreshDueSites(deps));
      if (summary.checked + summary.updated + summary.failed + summary.dropped > 0) {
        logger.info(`[sites] website refresh ${JSON.stringify(summary)}`);
      }
    } catch (error) {
      logger.error('[sites] website refresh failed', error);
    } finally {
      running = false;
    }
  };
  const interval = setInterval(run, intervalMs);
  interval.unref?.();
  return interval;
}
