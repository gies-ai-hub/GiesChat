import { Types } from 'mongoose';
import type { IMongoFile } from '@librechat/data-schemas';
import type { RefreshDeps } from './refresh';
import type { CrawlResult } from './crawl';
import { contentHash, replaceSiteCopy, retireCopy, saveSiteCopy } from './store';
import { refreshDueSites } from './refresh';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const userId = new Types.ObjectId().toString();
const URL_A = 'https://badm350.web.illinois.edu/schedule/';

const crawlOf = (text: string): CrawlResult => ({
  url: URL_A,
  pages: [{ url: URL_A, title: 'Schedule', text, words: 2, cleaned: false }],
  skipped: [],
});

/** Files and agent→file links held in memory; every dep is a spy over them. */
function world(links: Record<string, string[]> = {}) {
  const files = new Map<string, IMongoFile>();
  const agentFiles = new Map(Object.entries(links));
  const deps: RefreshDeps = {
    indexText: jest.fn(async () => true),
    createFile: jest.fn(async (data: Partial<IMongoFile>) => {
      files.set(data.file_id as string, data as IMongoFile);
      return data as IMongoFile;
    }),
    addAgentResourceFile: jest.fn(
      async ({ agent_id, file_id }: { agent_id: string; file_id: string }) => {
        agentFiles.set(agent_id, [...(agentFiles.get(agent_id) ?? []), file_id]);
      },
    ),
    removeAgentResourceFiles: jest.fn(
      async ({ agent_id, files: gone }: { agent_id: string; files: { file_id: string }[] }) => {
        const ids = new Set(gone.map((file) => file.file_id));
        agentFiles.set(
          agent_id,
          (agentFiles.get(agent_id) ?? []).filter((id) => !ids.has(id)),
        );
      },
    ),
    findAgentsUsingFile: jest.fn(async (fileId: string) =>
      [...agentFiles].filter(([, ids]) => ids.includes(fileId)).map(([id]) => ({ id })),
    ),
    deleteVectors: jest.fn(async () => undefined),
    deleteFiles: jest.fn(async (ids: string[]) => ids.forEach((id) => files.delete(id))),
    resolveEndpoint: jest.fn(async () => null),
    getDueWebsiteCopies: jest.fn(async () => [...files.values()]),
    markWebsiteChecked: jest.fn(async () => undefined),
    crawl: jest.fn(async () => crawlOf('Week 5 Tuesday')),
  };
  return { files, agentFiles, deps };
}

describe('saveSiteCopy', () => {
  it('saves one agent document with the site metadata and attaches it', async () => {
    const { deps, files, agentFiles } = world();
    const now = new Date('2026-10-13T02:00:00.000Z');

    const file = await saveSiteCopy(deps, {
      userId,
      agentId: 'agent_a',
      crawl: crawlOf('Week 5 Tuesday'),
      now,
    });

    expect(files.size).toBe(1);
    expect(file).toMatchObject({
      filename: 'Website · badm350.web.illinois.edu/schedule',
      source: 'text',
      context: 'agents',
      embedded: true,
      metadata: {
        sourceUrl: URL_A,
        pages: 1,
        contentHash: contentHash(crawlOf('Week 5 Tuesday').pages),
        checkedAt: now,
      },
    });
    expect(file.text).toBe(`## Schedule (${URL_A})\n\nWeek 5 Tuesday`);
    expect(agentFiles.get('agent_a')).toEqual([file.file_id]);
  });

  it('still saves an inline-only copy when indexing fails', async () => {
    const { deps } = world();
    (deps.indexText as jest.Mock).mockRejectedValueOnce(new Error('RAG down'));

    const file = await saveSiteCopy(deps, { userId, agentId: 'agent_a', crawl: crawlOf('x y') });

    expect(file.embedded).toBe(false);
  });
});

describe('replaceSiteCopy and retireCopy', () => {
  it('re-adding the same address leaves exactly one copy', async () => {
    const { deps, files, agentFiles } = world();
    const first = await saveSiteCopy(deps, { userId, agentId: 'agent_a', crawl: crawlOf('old') });

    const second = await replaceSiteCopy(deps, {
      userId,
      agentId: 'agent_a',
      crawl: crawlOf('new'),
      previous: [first],
    });

    expect([...files.keys()]).toEqual([second.file_id]);
    expect(agentFiles.get('agent_a')).toEqual([second.file_id]);
    expect(deps.deleteVectors).toHaveBeenCalledWith({ userId, file: first });
  });

  it('keeps a copy another agent still uses', async () => {
    const { deps, files } = world({ agent_a: ['shared'], agent_draft: ['shared'] });
    files.set('shared', { file_id: 'shared' } as IMongoFile);

    await retireCopy(deps, { agentId: 'agent_a', file: files.get('shared') as IMongoFile, userId });

    expect(files.has('shared')).toBe(true);
    expect(deps.deleteFiles).not.toHaveBeenCalled();
  });
});

describe('refreshDueSites', () => {
  async function seeded(text: string) {
    const ctx = world();
    const file = await saveSiteCopy(ctx.deps, {
      userId,
      agentId: 'agent_a',
      crawl: crawlOf(text),
      now: new Date('2026-10-11T00:00:00.000Z'),
    });
    jest.clearAllMocks();
    return { ...ctx, file };
  }

  it('only stamps checkedAt when the site text is unchanged', async () => {
    const { deps, file } = await seeded('Week 5 Tuesday');
    const now = new Date('2026-10-13T03:00:00.000Z');

    const summary = await refreshDueSites(deps, now);

    expect(summary).toEqual({ checked: 1, updated: 0, failed: 0 });
    expect(deps.markWebsiteChecked).toHaveBeenCalledWith(file.file_id, now);
    expect(deps.createFile).not.toHaveBeenCalled();
    expect(deps.resolveEndpoint).not.toHaveBeenCalled();
  });

  it('swaps in a new copy for every agent using it when the site changed', async () => {
    const { deps, files, agentFiles, file } = await seeded('Week 4 Monday');
    agentFiles.set('agent_draft', [file.file_id]);

    const summary = await refreshDueSites(deps);

    expect(summary).toEqual({ checked: 0, updated: 1, failed: 0 });
    expect(files.has(file.file_id)).toBe(false);
    expect(agentFiles.get('agent_a')).toHaveLength(1);
    expect(agentFiles.get('agent_draft')).toHaveLength(1);
    expect(agentFiles.get('agent_a')).not.toEqual(agentFiles.get('agent_draft'));
  });

  it('keeps the old copy when the site is down or has no readable pages', async () => {
    const { deps, files, file } = await seeded('Week 4 Monday');
    (deps.crawl as jest.Mock).mockRejectedValueOnce(new Error('ECONNREFUSED'));

    expect(await refreshDueSites(deps)).toEqual({ checked: 0, updated: 0, failed: 1 });
    (deps.crawl as jest.Mock).mockResolvedValueOnce({ url: URL_A, pages: [], skipped: [] });
    expect(await refreshDueSites(deps)).toEqual({ checked: 0, updated: 0, failed: 1 });
    expect(files.has(file.file_id)).toBe(true);
    expect(deps.deleteFiles).not.toHaveBeenCalled();
    expect(deps.markWebsiteChecked).not.toHaveBeenCalled();
  });
});
