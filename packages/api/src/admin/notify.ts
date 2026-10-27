import { logger, runAsSystem } from '@librechat/data-schemas';
import type { AdminUsageDeps } from './usage';
import { isLeader } from '~/cluster';

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

export interface DraftOutdatedEmail {
  email: string;
  agentName: string;
  /** Who saved production's newest version, by display name. */
  changedBy: string;
  from: number;
  to: number;
}

export interface DraftNotifyDeps {
  findAgents: AdminUsageDeps['findAgents'];
  findUsers: AdminUsageDeps['findUsers'];
  setAgentMeta: AdminUsageDeps['setAgentMeta'];
  /** Failures throw; the draft stays unmarked so the next pass tries again. */
  sendDraftOutdated: (params: DraftOutdatedEmail) => Promise<void>;
}

/**
 * Emails each open draft's owner once when production has moved past the draft's base.
 * `notifiedBase` remembers the base they were told about, so a burst of production saves
 * is one email, and the next one waits until they update the draft and fall behind again.
 * Someone who made the newest production version themselves is marked without an email.
 */
export async function notifyOutdatedDrafts(deps: DraftNotifyDeps): Promise<number> {
  const drafts = (
    await deps.findAgents(
      { draftOf: { $exists: true }, postedVersion: null },
      'id author draftOf draftBase notifiedBase',
    )
  ).filter((draft) => draft.notifiedBase !== (draft.draftBase ?? 0));
  if (drafts.length === 0) {
    return 0;
  }
  const productions = await deps.findAgents(
    { id: { $in: [...new Set(drafts.map((draft) => draft.draftOf))] } },
    'id name author versions',
  );
  const byId = new Map(productions.map((agent) => [agent.id, agent]));
  const behind = drafts.flatMap((draft) => {
    const production = byId.get(draft.draftOf ?? '');
    const to = production?.versions?.length ?? 0;
    if (production == null || to <= (draft.draftBase ?? 0)) {
      return [];
    }
    const newest = production.versions?.[to - 1] as { updatedBy?: unknown } | undefined;
    const changerId = String(newest?.updatedBy ?? production.author);
    return [{ draft, production, to, changerId }];
  });
  if (behind.length === 0) {
    return 0;
  }
  const people = await deps.findUsers(
    {
      _id: {
        $in: [
          ...new Set(behind.flatMap(({ draft, changerId }) => [String(draft.author), changerId])),
        ],
      },
    },
    '_id name email',
  );
  const byUser = new Map(people.map((user) => [String(user._id), user]));

  let sent = 0;
  for (const { draft, production, to, changerId } of behind) {
    const owner = byUser.get(String(draft.author));
    const from = draft.draftBase ?? 0;
    try {
      if (owner?.email && changerId !== String(draft.author)) {
        await deps.sendDraftOutdated({
          email: owner.email,
          agentName: production.name ?? '',
          changedBy: byUser.get(changerId)?.name || 'Someone',
          from,
          to,
        });
        sent += 1;
      }
      await deps.setAgentMeta(draft.id, { notifiedBase: from });
    } catch (error) {
      logger.warn(`[drafts] could not tell the owner of ${draft.id} that production moved`, error);
    }
  }
  return sent;
}

/** Every 15 minutes, leader only, never overlapping. `DRAFT_NOTIFY_INTERVAL_MS=0` turns it off. */
export function startDraftNotify(deps: DraftNotifyDeps): NodeJS.Timeout | null {
  const intervalMs = Number(process.env.DRAFT_NOTIFY_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
  if (!intervalMs) {
    logger.info('[drafts] Draft emails disabled by DRAFT_NOTIFY_INTERVAL_MS=0');
    return null;
  }
  let running = false;
  const run = async () => {
    if (running || !(await isLeader())) {
      return;
    }
    running = true;
    try {
      const sent = await runAsSystem(() => notifyOutdatedDrafts(deps));
      if (sent > 0) {
        logger.info(`[drafts] emailed ${sent} draft owner(s) that production moved on`);
      }
    } catch (error) {
      logger.error('[drafts] draft email pass failed', error);
    } finally {
      running = false;
    }
  };
  const interval = setInterval(run, intervalMs);
  interval.unref?.();
  return interval;
}
