import { randomBytes } from 'node:crypto';
import { ResourceType, PermissionBits, sanitizeLayout } from 'librechat-data-provider';
import { logger, isValidObjectIdString } from '@librechat/data-schemas';
import type { AdminDashboardPanel } from 'librechat-data-provider';
import type {
  IUser,
  IAgent,
  IGroup,
  IAgentEmbed,
  AgentEmbedAudience,
} from '@librechat/data-schemas';
import type { FilterQuery, Types } from 'mongoose';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import {
  toBuckets,
  zeroFillDays,
  medianFromDistribution,
  TURN_BUCKETS,
  REACH_BUCKETS,
} from './analytics';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 30;
const MIN_DAYS = 1;
const MAX_DAYS = 365;

const AGENT_SCOPE_FIELDS =
  '_id id name author description avatar category course embed.audience embed.greeting +embed.key';
const EMBED_AUDIENCES: AgentEmbedAudience[] = ['public', 'illinois'];
const EMBED_GREETING_MAX = 1000;
/** Only agents built from the class dashboard are listed there. Must match the client. */
const DASHBOARD_ORIGIN = 'dashboard';
const STUDENT_FIELDS = '_id name email';

/** Per-agent activity totals for the entities that actually have activity. */
export interface AgentUsageRow {
  agentId: string;
  conversationCount: number;
  userCount: number;
  messageCount: number;
  lastActivity: Date | null;
}

/** Per-student activity totals for the entities that actually have activity. */
export interface StudentUsageRow {
  userId: string;
  conversationCount: number;
  messageCount: number;
  lastActivity: Date | null;
}

export interface AgentUsageScope {
  agentIds: string[];
  /** `null` means every user; `[]` means no user (an empty group). */
  userIds: string[] | null;
  since: Date;
}

export interface StudentUsageScope {
  agentId: string;
  /** `null` means every user; `[]` means no user (an empty group). */
  userIds: string[] | null;
  since: Date;
}

export interface AgentAnalyticsScope {
  agentIds: string[];
  /** `null` means every user; `[]` means no user (an empty group). */
  userIds: string[] | null;
  since: Date;
}

/** Raw distributions from the pipeline. Buckets, medians, and zero-fill happen here. */
export interface AgentAnalyticsRaw {
  conversationCount: number;
  activeStudents: number;
  /** Students active on two or more distinct UTC days. */
  returningStudents: number;
  assistantMessageCount: number;
  erroredMessageCount: number;
  turnDistribution: { turns: number; conversations: number }[];
  studentDistribution: { conversations: number; students: number }[];
  daily: { date: string; conversations: number }[];
}

export interface AdminUsageDeps {
  findAgents: (
    filter: FilterQuery<IAgent>,
    fieldsToSelect?: string | string[] | null,
  ) => Promise<IAgent[]>;
  findAccessibleResources: (params: {
    userId: string;
    role?: string | null;
    resourceType: string;
    requiredPermissions: number;
  }) => Promise<Types.ObjectId[]>;
  findGroupById: (groupId: string, projection?: Record<string, 0 | 1>) => Promise<IGroup | null>;
  findUsers: (
    searchCriteria: FilterQuery<IUser>,
    fieldsToSelect?: string | string[] | null,
  ) => Promise<IUser[]>;
  aggregateAgentUsage: (scope: AgentUsageScope) => Promise<AgentUsageRow[]>;
  aggregateStudentUsage: (scope: StudentUsageScope) => Promise<StudentUsageRow[]>;
  aggregateAgentAnalytics: (scope: AgentAnalyticsScope) => Promise<AgentAnalyticsRaw>;
  updateUser: (userId: string, updateData: Partial<IUser>) => Promise<IUser | null>;
  setAgentEmbed: (agentId: string, embed: IAgentEmbed | null) => Promise<IAgent | null>;
}

/** What the dashboard shows the professor; `key` is the only place it ever leaves the server. */
interface AgentEmbedItem {
  key: string;
  audience: AgentEmbedAudience;
  greeting: string | null;
}

/** Untrusted body → validated settings, or `null` when the body is malformed. */
export function parseEmbedSettings(body: unknown): Omit<IAgentEmbed, 'key'> | null {
  if (typeof body !== 'object' || body == null) {
    return null;
  }
  const { audience, greeting } = body as { audience?: unknown; greeting?: unknown };
  if (!EMBED_AUDIENCES.includes(audience as AgentEmbedAudience)) {
    return null;
  }
  if (greeting != null && typeof greeting !== 'string') {
    return null;
  }
  const trimmed = typeof greeting === 'string' ? greeting.trim().slice(0, EMBED_GREETING_MAX) : '';
  return { audience: audience as AgentEmbedAudience, ...(trimmed ? { greeting: trimmed } : {}) };
}

const toEmbedItem = (embed: IAgentEmbed | undefined): AgentEmbedItem | null =>
  embed?.key
    ? { key: embed.key, audience: embed.audience, greeting: embed.greeting ?? null }
    : null;

/** The dashboard's analytics section — aggregate only, no student is identified. */
interface AnalyticsResponse {
  activeStudents: number;
  /** Class roster size; equals `activeStudents` when no class filter is applied. */
  enrolledStudents: number;
  conversationCount: number;
  medianTurns: number;
  returnRate: number;
  dailyActivity: { date: string; conversationCount: number }[];
  reachBuckets: { label: string; count: number }[];
  depthBuckets: { label: string; count: number }[];
  oneTurnShare: number;
  errorRate: number;
}

interface AgentUsageItem {
  agent_id: string;
  name: string;
  description: string | null;
  avatar: NonNullable<IAgent['avatar']> | null;
  category: string | null;
  course: string | null;
  conversationCount: number;
  userCount: number;
  messageCount: number;
  lastActivity: string | null;
  /** Whether this caller holds DELETE on the agent — EDIT scope alone does not imply it. */
  canDelete: boolean;
  /** Live embed settings, or `null` when the agent is not embeddable. */
  embed: AgentEmbedItem | null;
}

interface StudentUsageItem {
  userId: string;
  name: string;
  email: string;
  conversationCount: number;
  messageCount: number;
  lastActivity: string | null;
}

interface MemberScope {
  /** `false` when a groupId was supplied but names no group — malformed or nonexistent. */
  found: boolean;
  userIds: string[] | null;
  /** Display fields for the resolved members; `null` when no group narrowed the scope. */
  users: Map<string, IUser> | null;
}

interface AgentUsageParams {
  agent_id?: unknown;
}

/** Untrusted query values are anything `qs` can produce, so only plain strings are honoured. */
function resolveSince(raw: unknown): Date {
  const days = typeof raw === 'string' ? parseInt(raw, 10) : Number.NaN;
  const effective = Number.isNaN(days)
    ? DEFAULT_DAYS
    : Math.min(Math.max(days, MIN_DAYS), MAX_DAYS);
  return new Date(Date.now() - effective * DAY_MS);
}

function byUsageThenName<T extends { conversationCount: number; name: string }>(
  a: T,
  b: T,
): number {
  return b.conversationCount - a.conversationCount || a.name.localeCompare(b.name);
}

export function createAdminUsageHandlers(deps: AdminUsageDeps): {
  listAgentUsage: (req: ServerRequest, res: Response) => Promise<Response>;
  listAgentStudentUsage: (req: ServerRequest, res: Response) => Promise<Response>;
  listAgentAnalytics: (req: ServerRequest, res: Response) => Promise<Response>;
  getDashboardLayout: (req: ServerRequest, res: Response) => Promise<Response>;
  updateDashboardLayout: (req: ServerRequest, res: Response) => Promise<Response>;
  updateAgentEmbed: (req: ServerRequest, res: Response) => Promise<Response>;
  revokeAgentEmbed: (req: ServerRequest, res: Response) => Promise<Response>;
} {
  const {
    findAgents,
    findAccessibleResources,
    findGroupById,
    findUsers,
    aggregateAgentUsage,
    aggregateStudentUsage,
    aggregateAgentAnalytics,
    updateUser,
    setAgentEmbed,
  } = deps;

  /**
   * The security boundary: an agent is in scope only when the caller authored it
   * or holds an EDIT grant on it. Narrowing by `agentId` keeps the same boundary.
   *
   * `createdVia` narrows the list to agents built from the dashboard itself. It is a
   * presentation filter, not a permission — a client can set it freely, so it must
   * never be relied on for access. The `$or` below remains the only boundary.
   */
  async function findScopedAgents(user: IUser, agentId?: string): Promise<IAgent[]> {
    const callerId = String(user._id);
    const editableIds = await findAccessibleResources({
      userId: callerId,
      role: user.role,
      resourceType: ResourceType.AGENT,
      requiredPermissions: PermissionBits.EDIT,
    });
    const scope: FilterQuery<IAgent> = {
      createdVia: DASHBOARD_ORIGIN,
      $or: [{ author: callerId }, { _id: { $in: editableIds } }],
    };
    return findAgents(
      agentId === undefined ? scope : { id: agentId, ...scope },
      AGENT_SCOPE_FIELDS,
    );
  }

  function isAuthor(user: IUser, agent: IAgent): boolean {
    return String(agent.author) === String(user._id);
  }

  /**
   * DELETE is a distinct permission bit from EDIT, so an agent can be in scope for the
   * usage list yet not be deletable by this caller. Reported per row so the dashboard
   * never renders a delete control that would come back 403.
   */
  async function findDeletableAgentIds(user: IUser): Promise<Set<string>> {
    const ids = await findAccessibleResources({
      userId: String(user._id),
      role: user.role,
      resourceType: ResourceType.AGENT,
      requiredPermissions: PermissionBits.DELETE,
    });
    return new Set(ids.map((id) => String(id)));
  }

  /**
   * `memberIds` holds `idOnTheSource` (an Entra GUID for every SSO user), not user
   * ObjectIds, while conversations and messages key on the mongo `_id`. Resolving
   * here is what keeps a class filter from matching zero activity. A member that
   * resolves to no user keeps its raw id so it still appears as a zero row rather
   * than silently vanishing from the roster.
   */
  async function resolveMemberScope(groupId: string | undefined): Promise<MemberScope> {
    if (groupId === undefined) {
      return { found: true, userIds: null, users: null };
    }
    /** A malformed id would make `findGroupById` throw a CastError and surface as a 500. */
    if (!isValidObjectIdString(groupId)) {
      return { found: false, userIds: null, users: null };
    }
    const group = await findGroupById(groupId, { memberIds: 1 });
    if (!group) {
      return { found: false, userIds: null, users: null };
    }

    const memberIds = Array.from(new Set(group.memberIds ?? []));
    if (memberIds.length === 0) {
      return { found: true, userIds: [], users: new Map<string, IUser>() };
    }

    const objectIds = memberIds.filter(isValidObjectIdString);
    const conditions: FilterQuery<IUser>[] = [{ idOnTheSource: { $in: memberIds } }];
    if (objectIds.length > 0) {
      conditions.push({ _id: { $in: objectIds } });
    }
    const members = await findUsers({ $or: conditions }, `${STUDENT_FIELDS} idOnTheSource`);

    const byMemberId = new Map<string, IUser>();
    for (const member of members) {
      if (member.idOnTheSource) {
        byMemberId.set(member.idOnTheSource, member);
      }
      byMemberId.set(String(member._id), member);
    }

    const users = new Map<string, IUser>();
    const seen = new Set<string>();
    const userIds: string[] = [];
    for (const memberId of memberIds) {
      const member = byMemberId.get(memberId);
      const userId = member === undefined ? memberId : String(member._id);
      if (seen.has(userId)) {
        continue;
      }
      seen.add(userId);
      userIds.push(userId);
      if (member !== undefined) {
        users.set(userId, member);
      }
    }

    return { found: true, userIds, users };
  }

  /** Resolves display fields for ids that are native user ObjectIds; others stay unresolved. */
  async function resolveUsers(userIds: string[]): Promise<Map<string, IUser>> {
    const lookupIds = userIds.filter(isValidObjectIdString);
    if (lookupIds.length === 0) {
      return new Map<string, IUser>();
    }
    const users = await findUsers({ _id: { $in: lookupIds } }, STUDENT_FIELDS);
    return new Map(users.map((user) => [String(user._id), user]));
  }

  async function listAgentUsageHandler(req: ServerRequest, res: Response) {
    const caller = req.user;
    if (!caller?._id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const rawGroupId = req.query.groupId;
    if (rawGroupId !== undefined && typeof rawGroupId !== 'string') {
      return res.status(400).json({ error: 'groupId must be a string' });
    }

    const since = resolveSince(req.query.days);

    try {
      const scope = await resolveMemberScope(rawGroupId);
      if (!scope.found) {
        return res.status(404).json({ error: 'Group not found' });
      }

      const agents = await findScopedAgents(caller);
      const [usage, deletableIds] = await Promise.all([
        aggregateAgentUsage({
          agentIds: agents.map((agent) => agent.id),
          userIds: scope.userIds,
          since,
        }),
        findDeletableAgentIds(caller),
      ]);
      const usageByAgent = new Map(usage.map((row) => [row.agentId, row]));

      const items: AgentUsageItem[] = agents.map((agent) => {
        const row = usageByAgent.get(agent.id);
        return {
          agent_id: agent.id,
          name: agent.name ?? '',
          description: agent.description ?? null,
          avatar: agent.avatar ?? null,
          category: agent.category ?? null,
          course: agent.course ?? null,
          conversationCount: row?.conversationCount ?? 0,
          userCount: row?.userCount ?? 0,
          messageCount: row?.messageCount ?? 0,
          lastActivity: row?.lastActivity?.toISOString() ?? null,
          canDelete: isAuthor(caller, agent) || deletableIds.has(String(agent._id)),
          embed: toEmbedItem(agent.embed),
        };
      });
      items.sort(byUsageThenName);

      return res.status(200).json({ agents: items });
    } catch (error) {
      logger.error('[adminUsage] listAgentUsage error:', error);
      return res.status(500).json({ error: 'Failed to list agent usage' });
    }
  }

  async function listAgentStudentUsageHandler(req: ServerRequest, res: Response) {
    if (!req.user?._id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { agent_id: rawAgentId } = req.params as AgentUsageParams;
    if (typeof rawAgentId !== 'string' || rawAgentId === '') {
      return res.status(400).json({ error: 'agent_id must be a string' });
    }

    const rawGroupId = req.query.groupId;
    if (rawGroupId !== undefined && typeof rawGroupId !== 'string') {
      return res.status(400).json({ error: 'groupId must be a string' });
    }

    const since = resolveSince(req.query.days);

    try {
      const [agent] = await findScopedAgents(req.user, rawAgentId);
      if (!agent) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const scope = await resolveMemberScope(rawGroupId);
      if (!scope.found) {
        return res.status(404).json({ error: 'Group not found' });
      }

      const usage = await aggregateStudentUsage({
        agentId: rawAgentId,
        userIds: scope.userIds,
        since,
      });
      const usageByUser = new Map(usage.map((row) => [row.userId, row]));

      /** With a group, every member is listed — non-participation is the signal faculty want. */
      const userIds = scope.userIds ?? usage.map((row) => row.userId);
      /** The group path already resolved its members; re-reading them would be a second round trip. */
      const usersById = scope.users ?? (await resolveUsers(userIds));

      const items: StudentUsageItem[] = userIds.map((userId) => {
        const row = usageByUser.get(userId);
        const user = usersById.get(userId);
        return {
          userId,
          name: user?.name ?? '',
          email: user?.email ?? '',
          conversationCount: row?.conversationCount ?? 0,
          messageCount: row?.messageCount ?? 0,
          lastActivity: row?.lastActivity?.toISOString() ?? null,
        };
      });
      items.sort(byUsageThenName);

      return res.status(200).json({ agent_id: rawAgentId, students: items });
    } catch (error) {
      logger.error('[adminUsage] listAgentStudentUsage error:', error);
      return res.status(500).json({ error: 'Failed to list student usage' });
    }
  }

  /** Guards a rate against a zero denominator so the dashboard never receives NaN. */
  function rate(numerator: number, denominator: number): number {
    return denominator === 0 ? 0 : numerator / denominator;
  }

  async function listAgentAnalyticsHandler(req: ServerRequest, res: Response) {
    const caller = req.user;
    if (!caller?._id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const rawGroupId = req.query.groupId;
    if (rawGroupId !== undefined && typeof rawGroupId !== 'string') {
      return res.status(400).json({ error: 'groupId must be a string' });
    }

    const since = resolveSince(req.query.days);

    try {
      const scope = await resolveMemberScope(rawGroupId);
      if (!scope.found) {
        return res.status(404).json({ error: 'Group not found' });
      }

      const agents = await findScopedAgents(caller);
      const raw = await aggregateAgentAnalytics({
        agentIds: agents.map((agent) => agent.id),
        userIds: scope.userIds,
        since,
      });

      const oneTurnCount =
        raw.turnDistribution.find((entry) => entry.turns === 1)?.conversations ?? 0;

      const body: AnalyticsResponse = {
        activeStudents: raw.activeStudents,
        enrolledStudents: scope.userIds?.length ?? raw.activeStudents,
        conversationCount: raw.conversationCount,
        medianTurns: medianFromDistribution(raw.turnDistribution, 'turns', 'conversations'),
        returnRate: rate(raw.returningStudents, raw.activeStudents),
        dailyActivity: zeroFillDays(raw.daily, since, new Date()),
        reachBuckets: toBuckets(
          raw.studentDistribution,
          'conversations',
          'students',
          REACH_BUCKETS,
        ),
        depthBuckets: toBuckets(raw.turnDistribution, 'turns', 'conversations', TURN_BUCKETS),
        oneTurnShare: rate(oneTurnCount, raw.conversationCount),
        errorRate: rate(raw.erroredMessageCount, raw.assistantMessageCount),
      };

      return res.status(200).json(body);
    } catch (error) {
      logger.error('[adminUsage] listAgentAnalytics error:', error);
      return res.status(500).json({ error: 'Failed to load analytics' });
    }
  }

  /**
   * A personal display preference, not class data — which is why these two carry
   * `access:admin` alone and touch nothing but the caller's own document.
   */
  async function getDashboardLayoutHandler(req: ServerRequest, res: Response) {
    const caller = req.user;
    if (!caller?._id) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    return res.status(200).json({ panels: sanitizeLayout(caller.dashboardPanels) });
  }

  async function updateDashboardLayoutHandler(req: ServerRequest, res: Response) {
    const caller = req.user;
    if (!caller?._id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { panels: rawPanels } = (req.body ?? {}) as { panels?: unknown };
    if (!Array.isArray(rawPanels)) {
      return res.status(400).json({ error: 'panels must be an array' });
    }

    const panels: AdminDashboardPanel[] = sanitizeLayout(rawPanels);

    try {
      /** The caller's own id, never a body or path parameter — one professor's layout is not another's. */
      await updateUser(String(caller._id), { dashboardPanels: panels });
      return res.status(200).json({ panels });
    } catch (error) {
      logger.error('[adminUsage] updateDashboardLayout error:', error);
      return res.status(500).json({ error: 'Failed to save dashboard layout' });
    }
  }

  /**
   * Turns embedding on, or updates its settings. The key is minted once and kept
   * across settings edits so a link already pasted into Canvas keeps working;
   * revoking is the only way to rotate it. Scope is the same author-or-EDIT
   * boundary as every other handler here.
   */
  async function updateAgentEmbed(req: ServerRequest, res: Response): Promise<Response> {
    const rawAgentId = (req.params as AgentUsageParams).agent_id;
    if (typeof rawAgentId !== 'string') {
      return res.status(400).json({ error: 'agent_id is required' });
    }
    const settings = parseEmbedSettings(req.body);
    if (settings == null) {
      return res.status(400).json({ error: 'Invalid embed settings' });
    }
    const caller = req.user;
    if (caller == null) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
      const [agent] = await findScopedAgents(caller, rawAgentId);
      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }
      const key = agent.embed?.key ?? randomBytes(16).toString('hex');
      const updated = await setAgentEmbed(agent.id, { key, ...settings });
      return res.status(200).json({ embed: toEmbedItem(updated?.embed) });
    } catch (error) {
      logger.error('[adminUsage] updateAgentEmbed error:', error);
      return res.status(500).json({ error: 'Failed to update embed settings' });
    }
  }

  /** Stops new visits immediately; tabs already open run until their token lapses. */
  async function revokeAgentEmbed(req: ServerRequest, res: Response): Promise<Response> {
    const rawAgentId = (req.params as AgentUsageParams).agent_id;
    if (typeof rawAgentId !== 'string') {
      return res.status(400).json({ error: 'agent_id is required' });
    }
    const caller = req.user;
    if (caller == null) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
      const [agent] = await findScopedAgents(caller, rawAgentId);
      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }
      await setAgentEmbed(agent.id, null);
      return res.status(200).json({ embed: null });
    } catch (error) {
      logger.error('[adminUsage] revokeAgentEmbed error:', error);
      return res.status(500).json({ error: 'Failed to revoke embed' });
    }
  }

  return {
    listAgentUsage: listAgentUsageHandler,
    updateAgentEmbed,
    revokeAgentEmbed,
    listAgentStudentUsage: listAgentStudentUsageHandler,
    listAgentAnalytics: listAgentAnalyticsHandler,
    getDashboardLayout: getDashboardLayoutHandler,
    updateDashboardLayout: updateDashboardLayoutHandler,
  };
}
