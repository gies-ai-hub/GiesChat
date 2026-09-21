import { randomBytes } from 'node:crypto';
import { ResourceType, PermissionBits, sanitizeLayout } from 'librechat-data-provider';
import { logger, isValidObjectIdString } from '@librechat/data-schemas';
import type { AdminDashboardPanel } from 'librechat-data-provider';
import type {
  IUser,
  IAgent,
  IGroup,
  IMongoFile,
  IAgentMeta,
  IAgentEmbed,
  AgentEmbedAudience,
} from '@librechat/data-schemas';
import type { FilterQuery, Types } from 'mongoose';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import type { TopicsModel, TopicsResult } from './topics';
import { summarizeTopics, TOPIC_SAMPLE_LIMIT } from './topics';
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
  '_id id name author description avatar category course collaborators pendingCollaborators draftOf draftBase postedVersion embed.audience embed.greeting +embed.key';
/** ponytail: `versions` is loaded whole to count it; switch to a `$size` aggregation if agents ever carry hundreds of versions. */
const AGENT_LIST_FIELDS = `${AGENT_SCOPE_FIELDS} versions`;
const DRAFT_FIELDS =
  '_id id name author draftOf draftBase postedVersion updatedAt embed.audience embed.greeting +embed.key';
const EMBED_AUDIENCES: AgentEmbedAudience[] = ['public', 'illinois'];
const EMBED_GREETING_MAX = 1000;
/** Only agents built from the class dashboard are listed there. Must match the client. */
const DASHBOARD_ORIGIN = 'dashboard';
const STUDENT_FIELDS = '_id name email';
/** Same projection, used where the people are colleagues rather than students. */
const USER_FIELDS = STUDENT_FIELDS;

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
  sampleStudentMessages: (scope: AgentAnalyticsScope, limit: number) => Promise<string[]>;
  /** `null` when no model is configured; the topics panel then reports unavailable. */
  resolveTopicsModel: () => Promise<TopicsModel | null>;
  updateUser: (userId: string, updateData: Partial<IUser>) => Promise<IUser | null>;
  setAgentEmbed: (agentId: string, embed: IAgentEmbed | null) => Promise<IAgent | null>;
  /** The full document (tool_resources, versions), for cloning and posting. */
  getAgent: (filter: FilterQuery<IAgent>) => Promise<IAgent | null>;
  setAgentMeta: (agentId: string, meta: IAgentMeta) => Promise<IAgent | null>;
  createAgent: (data: Partial<IAgent> & { id: string; author: string }) => Promise<IAgent>;
  createAgentId: () => string;
  /** ACL grant on a draft: `owner` for the collaborator, `viewer` so the author can open it in chat. */
  grantAgentAccess: (params: {
    userId: string;
    agentDbId: Types.ObjectId | string;
    role: 'owner' | 'viewer';
  }) => Promise<void>;
  updateAgent: (
    filter: FilterQuery<IAgent>,
    data: Partial<IAgent>,
    options: { updatingUserId: string; forceVersion?: boolean },
  ) => Promise<IAgent | null>;
  getFiles: (
    filter: FilterQuery<IMongoFile>,
    sort: null,
    select: Record<string, 0 | 1>,
  ) => Promise<IMongoFile[] | null>;
  /**
   * Copies search-indexed documents so `agentId` owns and can search them; returns
   * source file_id → copy file_id. The RAG API ignores a second embed of one file_id.
   */
  copyDocuments: (params: {
    req: ServerRequest;
    files: IMongoFile[];
    agentId: string;
  }) => Promise<Map<string, string>>;
  /** One invite email per newly invited address. Failures are logged, never surfaced. */
  sendCollaboratorInvite: (params: {
    email: string;
    agentName: string;
    inviterName: string;
  }) => Promise<void>;
}

/** What the dashboard shows the professor; `key` is the only place it ever leaves the server. */
interface AgentEmbedItem {
  key: string;
  audience: AgentEmbedAudience;
  greeting: string | null;
}

/** A person named on a dashboard row: never an email-only identity, never a raw document. */
export interface UserRef {
  id: string;
  name: string;
  email: string;
}

export interface AgentDraftItem {
  draft_id: string;
  owner: UserRef;
  /** Production's version count when the draft was cloned. */
  draftBase: number;
  /** The production version this draft became, or `null` while it is still open. */
  postedVersion: number | null;
  updatedAt: string | null;
  /** Whether the caller owns this draft. */
  mine: boolean;
  /** The draft's test link, minted through the embed endpoints on the draft id. */
  embed: AgentEmbedItem | null;
}

const MAX_COLLABORATORS = 50;
/** Sign-in is Illinois SSO, so no other domain could ever claim an invite. */
const INVITE_DOMAIN = '@illinois.edu';
const EMAIL_PATTERN = /^[a-z0-9][a-z0-9._%+-]*@illinois\.edu$/;

/** Untrusted body → lowercased Illinois addresses, or `null` when malformed. */
export function parseInviteEmails(body: unknown): string[] | null {
  if (body == null || typeof body !== 'object') {
    return null;
  }
  const raw = (body as { emails?: unknown }).emails;
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw) || raw.length > MAX_COLLABORATORS) {
    return null;
  }
  const emails = raw
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => EMAIL_PATTERN.test(value) && value.endsWith(INVITE_DOMAIN));
  return [...new Set(emails)];
}

/**
 * What a draft copies from production and what posting copies back. Identity,
 * sharing and bookkeeping (`id`, `author`, `embed`, `collaborators`, `versions`,
 * `draftOf`, `createdVia`) are deliberately absent: they belong to one document.
 */
export const DRAFT_FIELDS_TO_COPY = [
  'name',
  'description',
  'instructions',
  'avatar',
  'provider',
  'model',
  'model_parameters',
  'artifacts',
  'recursion_limit',
  'tools',
  'skills',
  'skills_enabled',
  'conversation_starters',
  'tool_resources',
  'category',
  'course',
  'tool_options',
  'memory_scope',
  'end_after_tools',
  'hide_sequential_outputs',
] as const;

type DraftField = (typeof DRAFT_FIELDS_TO_COPY)[number];
export type DraftFields = Pick<IAgent, DraftField>;

export function pickDraftFields(agent: IAgent): Partial<DraftFields> {
  return Object.fromEntries(
    DRAFT_FIELDS_TO_COPY.filter((field) => agent[field] !== undefined).map((field) => [
      field,
      agent[field],
    ]),
  ) as Partial<DraftFields>;
}

/** Untrusted body → deduplicated ObjectId strings, or `null` when malformed. */
export function parseCollaboratorIds(body: unknown): string[] | null {
  if (body == null || typeof body !== 'object') {
    return null;
  }
  const raw = (body as { userIds?: unknown }).userIds;
  if (!Array.isArray(raw) || raw.length > MAX_COLLABORATORS) {
    return null;
  }
  const ids = raw.filter(
    (value): value is string => typeof value === 'string' && isValidObjectIdString(value),
  );
  return [...new Set(ids)];
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
  /** Production version students run — the count of saved versions. */
  version: number;
  /** The caller authored this agent: they alone may set collaborators and post drafts. */
  isAuthor: boolean;
  /** The caller is listed as a collaborator: they draft and test, never edit production. */
  isCollaborator: boolean;
  /** Drafts of this agent not yet posted (all of them for the author, the caller's own otherwise). */
  draftCount: number;
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

interface DraftParams extends AgentUsageParams {
  draft_id?: unknown;
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
  listAgentTopics: (req: ServerRequest, res: Response) => Promise<Response>;
  getDashboardLayout: (req: ServerRequest, res: Response) => Promise<Response>;
  updateDashboardLayout: (req: ServerRequest, res: Response) => Promise<Response>;
  updateAgentEmbed: (req: ServerRequest, res: Response) => Promise<Response>;
  revokeAgentEmbed: (req: ServerRequest, res: Response) => Promise<Response>;
  updateAgentCollaborators: (req: ServerRequest, res: Response) => Promise<Response>;
  listAgentDrafts: (req: ServerRequest, res: Response) => Promise<Response>;
  openAgentDraft: (req: ServerRequest, res: Response) => Promise<Response>;
  postAgentDraft: (req: ServerRequest, res: Response) => Promise<Response>;
} {
  const {
    findAgents,
    findAccessibleResources,
    findGroupById,
    findUsers,
    aggregateAgentUsage,
    aggregateStudentUsage,
    aggregateAgentAnalytics,
    sampleStudentMessages,
    resolveTopicsModel,
    updateUser,
    setAgentEmbed,
    getAgent,
    setAgentMeta,
    createAgent,
    createAgentId,
    grantAgentAccess,
    updateAgent,
    getFiles,
    copyDocuments,
    sendCollaboratorInvite,
  } = deps;

  /**
   * The security boundary: an agent is in scope when the caller authored it, holds an
   * EDIT grant on it, or is named in its `collaborators`. Narrowing by `agentId` keeps
   * the same boundary. A list call (no `agentId`) also drops drafts, so production
   * agents are the only rows; a lookup by id still finds a draft, which is how its
   * owner reaches the embed endpoints for the test link.
   *
   * `createdVia` narrows the list to agents built from the dashboard itself. It is a
   * presentation filter, not a permission — a client can set it freely, so it must
   * never be relied on for access. The `$or` below remains the only boundary.
   */
  async function findScopedAgents(
    user: IUser,
    agentId?: string,
    fields: string = AGENT_SCOPE_FIELDS,
  ): Promise<IAgent[]> {
    const callerId = String(user._id);
    const editableIds = await findAccessibleResources({
      userId: callerId,
      role: user.role,
      resourceType: ResourceType.AGENT,
      requiredPermissions: PermissionBits.EDIT,
    });
    const scope: FilterQuery<IAgent> = {
      createdVia: DASHBOARD_ORIGIN,
      ...(agentId === undefined ? { draftOf: { $exists: false } } : { id: agentId }),
      $or: [{ author: callerId }, { _id: { $in: editableIds } }, { collaborators: callerId }],
    };
    return findAgents(scope, fields);
  }

  function isAuthor(user: IUser, agent: IAgent): boolean {
    return String(agent.author) === String(user._id);
  }

  function isCollaborator(user: IUser, agent: IAgent): boolean {
    return !isAuthor(user, agent) && (agent.collaborators ?? []).includes(String(user._id));
  }

  /** Every draft of the given production agents; callers narrow to the ones the caller may see. */
  async function findDraftsOf(agentIds: string[]): Promise<IAgent[]> {
    if (agentIds.length === 0) {
      return [];
    }
    return findAgents({ draftOf: { $in: agentIds } }, DRAFT_FIELDS);
  }

  /** The author sees every unposted draft; anyone else only their own. */
  function visibleDrafts(user: IUser, agent: IAgent, drafts: IAgent[]): IAgent[] {
    const unposted = drafts.filter(
      (draft) => draft.draftOf === agent.id && draft.postedVersion == null,
    );
    return isAuthor(user, agent) ? unposted : unposted.filter((draft) => isAuthor(user, draft));
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

      const agents = await findScopedAgents(caller, undefined, AGENT_LIST_FIELDS);
      const [usage, deletableIds, drafts] = await Promise.all([
        aggregateAgentUsage({
          agentIds: agents.map((agent) => agent.id),
          userIds: scope.userIds,
          since,
        }),
        findDeletableAgentIds(caller),
        findDraftsOf(agents.map((agent) => agent.id)),
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
          version: agent.versions?.length ?? 0,
          isAuthor: isAuthor(caller, agent),
          isCollaborator: isCollaborator(caller, agent),
          draftCount: visibleDrafts(caller, agent, drafts).length,
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
   * What students ask, as topic labels and counts. Same scope as the analytics;
   * the model sees message text only and the client sees labels only.
   */
  async function listAgentTopicsHandler(req: ServerRequest, res: Response) {
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
      const [scope, agents, llm] = await Promise.all([
        resolveMemberScope(rawGroupId),
        findScopedAgents(caller),
        resolveTopicsModel(),
      ]);
      if (!scope.found) {
        return res.status(404).json({ error: 'Group not found' });
      }
      if (llm === null) {
        return res.status(503).json({ error: 'No model configured for topics' });
      }

      const agentIds = agents.map((agent) => agent.id).sort();
      const day = since.toISOString().slice(0, 10);
      const cacheKey = `${String(caller._id)}|${rawGroupId ?? ''}|${day}|${agentIds.join(',')}`;
      const texts = await sampleStudentMessages(
        { agentIds, userIds: scope.userIds, since },
        TOPIC_SAMPLE_LIMIT,
      );
      const body: TopicsResult = await summarizeTopics(cacheKey, texts, llm);
      return res.status(200).json(body);
    } catch (error) {
      logger.error('[adminUsage] listAgentTopics error:', error);
      return res.status(502).json({ error: 'Failed to summarize topics' });
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

  const toUserRef = (user: IUser): UserRef => ({
    id: String(user._id),
    name: user.name ?? '',
    email: user.email ?? '',
  });

  async function findUserRefs(ids: string[]): Promise<Map<string, UserRef>> {
    if (ids.length === 0) {
      return new Map();
    }
    const users = await findUsers({ _id: { $in: ids } }, STUDENT_FIELDS);
    return new Map(users.map((user) => [String(user._id), toUserRef(user)]));
  }

  /**
   * Author only: who may draft this agent. Ids without a user and the author itself are
   * dropped. An invited address that already has an account is added straight away;
   * the rest are kept as pending and emailed once, the first time they are invited.
   */
  async function updateAgentCollaborators(req: ServerRequest, res: Response): Promise<Response> {
    const rawAgentId = (req.params as AgentUsageParams).agent_id;
    if (typeof rawAgentId !== 'string') {
      return res.status(400).json({ error: 'agent_id is required' });
    }
    const requested = parseCollaboratorIds(req.body);
    const invited = parseInviteEmails(req.body);
    if (requested == null || invited == null) {
      return res.status(400).json({ error: 'userIds and emails must be arrays' });
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
      if (!isAuthor(caller, agent)) {
        return res.status(403).json({ error: 'Only the author can set collaborators' });
      }
      const callerEmail = caller.email?.trim().toLowerCase();
      const wanted = invited.filter((email) => email !== callerEmail);
      const existing =
        wanted.length > 0 ? await findUsers({ email: { $in: wanted } }, USER_FIELDS) : [];
      const byEmail = new Map(existing.map((user) => [user.email?.toLowerCase(), user]));
      const known = await findUserRefs(requested.filter((id) => id !== String(caller._id)));
      for (const user of existing) {
        known.set(String(user._id), toUserRef(user));
      }
      const collaborators = [...known.keys()];
      const pendingCollaborators = wanted.filter((email) => !byEmail.has(email));
      /** Read before the write: only an address that was not already pending is emailed. */
      const alreadyPending = new Set(agent.pendingCollaborators ?? []);
      const fresh = pendingCollaborators.filter((email) => !alreadyPending.has(email));
      await setAgentMeta(agent.id, { collaborators, pendingCollaborators });
      await Promise.all(
        fresh.map((email) =>
          sendCollaboratorInvite({
            email,
            agentName: agent.name ?? '',
            inviterName: caller.name ?? caller.email ?? '',
          }).catch((error) =>
            logger.warn(`[adminUsage] could not send the invite to ${email}`, error),
          ),
        ),
      );

      return res.status(200).json({
        collaborators: collaborators.flatMap((id) => known.get(id) ?? []),
        pending: pendingCollaborators,
        invited: fresh,
      });
    } catch (error) {
      logger.error('[adminUsage] updateAgentCollaborators error:', error);
      return res.status(500).json({ error: 'Failed to update collaborators' });
    }
  }

  const toDraftItem = (
    draft: IAgent,
    owners: Map<string, UserRef>,
    caller: IUser,
  ): AgentDraftItem => ({
    draft_id: draft.id,
    owner: owners.get(String(draft.author)) ?? { id: String(draft.author), name: '', email: '' },
    draftBase: draft.draftBase ?? 0,
    postedVersion: draft.postedVersion ?? null,
    updatedAt: (draft as IAgent & { updatedAt?: Date }).updatedAt?.toISOString() ?? null,
    mine: isAuthor(caller, draft),
    embed: toEmbedItem(draft.embed),
  });

  /** The author sees every open draft and the collaborator list; a collaborator sees their own draft. */
  async function listAgentDrafts(req: ServerRequest, res: Response): Promise<Response> {
    const rawAgentId = (req.params as AgentUsageParams).agent_id;
    if (typeof rawAgentId !== 'string') {
      return res.status(400).json({ error: 'agent_id is required' });
    }
    const caller = req.user;
    if (caller == null) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
      const [agent] = await findScopedAgents(caller, rawAgentId, AGENT_LIST_FIELDS);
      if (!agent || agent.draftOf != null) {
        return res.status(404).json({ error: 'Agent not found' });
      }
      const author = isAuthor(caller, agent);
      const drafts = visibleDrafts(caller, agent, await findDraftsOf([agent.id]));
      const people = await findUserRefs([
        ...drafts.map((draft) => String(draft.author)),
        ...(author ? (agent.collaborators ?? []) : []),
      ]);
      return res.status(200).json({
        agent_id: agent.id,
        version: agent.versions?.length ?? 0,
        collaborators: author
          ? (agent.collaborators ?? []).flatMap((id) => people.get(id) ?? [])
          : [],
        pending: author ? (agent.pendingCollaborators ?? []) : [],
        drafts: drafts.map((draft) => toDraftItem(draft, people, caller)),
      });
    } catch (error) {
      logger.error('[adminUsage] listAgentDrafts error:', error);
      return res.status(500).json({ error: 'Failed to list drafts' });
    }
  }

  const DOCUMENT_FIELDS = {
    file_id: 1,
    user: 1,
    filename: 1,
    filepath: 1,
    type: 1,
    bytes: 1,
    text: 1,
    source: 1,
    context: 1,
    embedded: 1,
  } as const;

  /**
   * Documents indexed for search are bound to the agent they were uploaded to, so an
   * agent built from another's fields gets its own copies of those; inline-only
   * documents stay shared. Best effort: when copying fails the ids stay shared and
   * the documents remain readable inline.
   */
  async function withOwnDocuments(
    req: ServerRequest,
    fields: Partial<DraftFields>,
    agentId: string,
  ): Promise<Partial<DraftFields>> {
    const context = fields.tool_resources?.context;
    const fileIds = context?.file_ids ?? [];
    if (fileIds.length === 0) {
      return fields;
    }
    const files = (await getFiles({ file_id: { $in: fileIds } }, null, DOCUMENT_FIELDS)) ?? [];
    const searched = files.filter((file) => file.embedded === true);
    if (searched.length === 0) {
      return fields;
    }
    let copies: Map<string, string>;
    try {
      copies = await copyDocuments({ req, files: searched, agentId });
    } catch (error) {
      logger.warn(
        `[adminUsage] could not copy ${searched.length} document(s) to ${agentId}; they stay shared and inline-only`,
        error,
      );
      return fields;
    }
    const remap = (ids: string[] | undefined) => ids?.map((id) => copies.get(id) ?? id);
    const search = fields.tool_resources?.file_search;
    return {
      ...fields,
      tool_resources: {
        ...fields.tool_resources,
        context: { ...context, file_ids: remap(fileIds) },
        ...(search ? { file_search: { ...search, file_ids: remap(search.file_ids) } } : {}),
      },
    };
  }

  /**
   * Find-or-create the caller's draft. The clone is a real agent the caller owns, so
   * the builder, chat, documents and embed links work on it unchanged. The author is
   * granted a view so the draft shows up in their chat agent list too.
   */
  async function openAgentDraft(req: ServerRequest, res: Response): Promise<Response> {
    const rawAgentId = (req.params as AgentUsageParams).agent_id;
    if (typeof rawAgentId !== 'string') {
      return res.status(400).json({ error: 'agent_id is required' });
    }
    const caller = req.user;
    if (caller == null) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
      const [scoped] = await findScopedAgents(caller, rawAgentId);
      if (!scoped || scoped.draftOf != null) {
        return res.status(404).json({ error: 'Agent not found' });
      }
      const mine = visibleDrafts(caller, scoped, await findDraftsOf([scoped.id])).find((draft) =>
        isAuthor(caller, draft),
      );
      if (mine) {
        return res.status(200).json({ draft_id: mine.id, created: false });
      }
      const production = await getAgent({ id: scoped.id });
      if (!production) {
        return res.status(404).json({ error: 'Agent not found' });
      }
      const callerId = String(caller._id);
      const draftId = createAgentId();
      const draft = await createAgent({
        ...(await withOwnDocuments(req, pickDraftFields(production), draftId)),
        id: draftId,
        author: callerId,
        createdVia: DASHBOARD_ORIGIN,
        draftOf: production.id,
        draftBase: production.versions?.length ?? 0,
      });
      await Promise.all([
        grantAgentAccess({
          userId: callerId,
          agentDbId: draft._id as Types.ObjectId,
          role: 'owner',
        }),
        grantAgentAccess({
          userId: String(production.author),
          agentDbId: draft._id as Types.ObjectId,
          role: 'viewer',
        }),
      ]);
      return res.status(200).json({ draft_id: draft.id, created: true });
    } catch (error) {
      logger.error('[adminUsage] openAgentDraft error:', error);
      return res.status(500).json({ error: 'Failed to open draft' });
    }
  }

  /**
   * Author only. Posting replaces production's copyable fields with the draft's and
   * records a version through the normal update path, so version history keeps the
   * old production. Search-indexed documents are copied to production first, since
   * their index is bound to the draft's id.
   */
  async function postAgentDraft(req: ServerRequest, res: Response): Promise<Response> {
    const { agent_id: rawAgentId, draft_id: rawDraftId } = req.params as DraftParams;
    if (typeof rawAgentId !== 'string' || typeof rawDraftId !== 'string') {
      return res.status(400).json({ error: 'agent_id and draft_id are required' });
    }
    const caller = req.user;
    if (caller == null) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
      const [scoped] = await findScopedAgents(caller, rawAgentId);
      if (!scoped || scoped.draftOf != null) {
        return res.status(404).json({ error: 'Agent not found' });
      }
      if (!isAuthor(caller, scoped)) {
        return res.status(403).json({ error: 'Only the author can post a draft to production' });
      }
      const draft = await getAgent({ id: rawDraftId, draftOf: scoped.id });
      if (!draft) {
        return res.status(404).json({ error: 'Draft not found' });
      }
      if (draft.postedVersion != null) {
        return res.status(409).json({ error: 'Draft already posted' });
      }
      const fields = await withOwnDocuments(req, pickDraftFields(draft), scoped.id);
      const updated = await updateAgent({ id: scoped.id }, fields, {
        updatingUserId: String(caller._id),
      });
      if (!updated) {
        return res.status(404).json({ error: 'Agent not found' });
      }
      const version = updated.versions?.length ?? 0;
      await setAgentMeta(draft.id, { postedVersion: version });
      return res.status(200).json({ agent_id: scoped.id, version });
    } catch (error) {
      logger.error('[adminUsage] postAgentDraft error:', error);
      return res.status(500).json({ error: 'Failed to post draft' });
    }
  }

  return {
    listAgentUsage: listAgentUsageHandler,
    updateAgentEmbed,
    revokeAgentEmbed,
    updateAgentCollaborators,
    listAgentDrafts,
    openAgentDraft,
    postAgentDraft,
    listAgentStudentUsage: listAgentStudentUsageHandler,
    listAgentAnalytics: listAgentAnalyticsHandler,
    listAgentTopics: listAgentTopicsHandler,
    getDashboardLayout: getDashboardLayoutHandler,
    updateDashboardLayout: updateDashboardLayoutHandler,
  };
}
