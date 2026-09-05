import type { InfiniteData } from '@tanstack/react-query';
import type * as p from '../accessPermissions';
import type * as a from '../types/agents';
import type * as s from '../schemas';
import type * as t from '../types';
import type { AdminDashboardPanel } from '../dashboard';
import type { AgentAvatar } from './assistants';

export type Conversation = {
  id: string;
  createdAt: number;
  participants: string[];
  lastMessage: string;
  conversations: s.TConversation[];
};

export type ConversationListParams = {
  cursor?: string;
  isArchived?: boolean;
  sortBy?: 'title' | 'createdAt' | 'updatedAt';
  sortDirection?: 'asc' | 'desc';
  tags?: string[];
  search?: string;
  projectId?: string;
};

export type MinimalConversation = Pick<
  s.TConversation,
  'conversationId' | 'endpoint' | 'title' | 'createdAt' | 'updatedAt' | 'user' | 'chatProjectId'
>;

export type ConversationListResponse = {
  conversations: MinimalConversation[];
  nextCursor: string | null;
};

export type ConversationData = InfiniteData<ConversationListResponse>;
export type ConversationUpdater = (
  data: ConversationData,
  conversation: s.TConversation,
) => ConversationData;

export type ProjectListParams = {
  cursor?: string;
  limit?: number;
  sortBy?: 'name' | 'createdAt' | 'lastConversationAt';
  sortDirection?: 'asc' | 'desc';
  search?: string;
};

export type ProjectListResponse = {
  projects: t.TChatProject[];
  nextCursor: string | null;
};

export type ProjectData = InfiniteData<ProjectListResponse>;

/* Messages */
export type MessagesListParams = {
  cursor?: string | null;
  sortBy?: 'endpoint' | 'createdAt' | 'updatedAt';
  sortDirection?: 'asc' | 'desc';
  pageSize?: number;
  conversationId?: string;
  messageId?: string;
  search?: string;
};

export type MessagesListResponse = {
  messages: s.TMessage[];
  nextCursor: string | null;
};

/* Shared Links */
export type SharedMessagesResponse = Omit<s.TSharedLink, 'messages'> & {
  messages: s.TMessage[];
};

export interface SharedLinksListParams {
  pageSize: number;
  sortBy: 'title' | 'createdAt';
  sortDirection: 'asc' | 'desc';
  search?: string;
  cursor?: string;
}

export type SharedLinkItem = {
  shareId: string;
  title: string;
  createdAt: Date;
  conversationId: string;
};

export interface SharedLinksResponse {
  links: SharedLinkItem[];
  nextCursor: string | null;
  hasNextPage: boolean;
}

export interface SharedLinkQueryData {
  pages: SharedLinksResponse[];
  pageParams: (string | null)[];
}

export type AllPromptGroupsFilterRequest = {
  category: string;
  pageNumber: string;
  pageSize: string | number;
  before?: string | null;
  after?: string | null;
  order?: 'asc' | 'desc';
  name?: string;
  author?: string;
};

export type AllPromptGroupsResponse = t.TPromptGroup[];

export type ConversationTagsResponse = s.TConversationTag[];

/* MCP Types */
export type MCPTool = {
  name: string;
  pluginKey: string;
  description: string;
};

export type MCPServer = {
  name: string;
  icon: string;
  authenticated: boolean;
  authConfig: s.TPluginAuthConfig[];
  tools: MCPTool[];
};

export type MCPServersResponse = {
  servers: Record<string, MCPServer>;
};

export type VerifyToolAuthParams = { toolId: string };
export type VerifyToolAuthResponse = {
  authenticated: boolean;
  message?: string | s.AuthType;
  authTypes?: [string, s.AuthType][];
};

export type GetToolCallParams = { conversationId: string };
export type ToolCallResults = a.ToolCallResult[];

/* Memories */
export type TUserMemory = {
  key: string;
  value: string;
  updated_at: string;
  tokenCount?: number;
  /** Agent partition this memory belongs to; absent = shared personal pool */
  agentId?: string;
  /** Display name of the partition's agent, resolved server-side when available */
  agentName?: string;
};

export type MemoriesResponse = {
  memories: TUserMemory[];
  totalTokens: number;
  tokenLimit: number | null;
  usagePercentage: number | null;
};

export type PrincipalSearchParams = {
  q: string;
  limit?: number;
  types?: Array<p.PrincipalType.USER | p.PrincipalType.GROUP | p.PrincipalType.ROLE>;
};

export type PrincipalSearchResponse = {
  query: string;
  limit: number;
  types?: Array<p.PrincipalType.USER | p.PrincipalType.GROUP | p.PrincipalType.ROLE>;
  results: p.TPrincipalSearchResult[];
  count: number;
  sources: {
    local: number;
    entra: number;
  };
};

export type AccessRole = {
  accessRoleId: p.AccessRoleIds;
  name: string;
  description: string;
  permBits: number;
};

export type AccessRolesResponse = AccessRole[];

export type ListRolesResponse = {
  roles: Array<{ _id?: string; name: string; description?: string }>;
  total: number;
  limit: number;
  offset?: number;
};

/**
 * Capabilities held by the calling user, with implications already expanded.
 * The endpoint is gated by `access:admin`, so a 403 means the caller holds none.
 */
export type AdminEffectiveCapabilitiesResponse = {
  capabilities: string[];
};

export type AdminGroupListParams = {
  search?: string;
  source?: string;
  limit?: number;
  offset?: number;
};

/** A group as returned by the admin groups endpoint; a "class" in professor-facing UI. */
export type AdminGroup = {
  _id: string;
  name: string;
  description?: string;
  source?: string;
  memberIds?: string[];
};

export type AdminGroupListResponse = {
  groups: AdminGroup[];
  total: number;
  limit: number;
  offset: number;
};

/** Shared filters for the admin usage endpoints; both are optional and unset means unfiltered. */
export type AdminUsageParams = {
  /** Restrict activity to members of this group. */
  groupId?: string;
  /** Only count activity from the last `days` days. */
  days?: number;
};

/** Activity counters common to every admin usage row. */
export type AdminUsageCounts = {
  conversationCount: number;
  messageCount: number;
  /** ISO 8601 timestamp of the most recent activity, or `null` when there is none. */
  lastActivity: string | null;
};

export type AdminAgentUsage = AdminUsageCounts & {
  agent_id: string;
  name: string;
  /** Identity for the dashboard's card strip; `null` when the agent has none set. */
  description: string | null;
  avatar: AgentAvatar | null;
  category: string | null;
  /** Free-text course label. Display only. */
  course: string | null;
  /** Distinct users who have used the agent within the requested window. */
  userCount: number;
  /** Whether the caller holds DELETE on this agent. EDIT scope alone does not imply it. */
  canDelete: boolean;
  /** Live embed settings, or `null` when the agent is not embeddable without login. */
  embed: AgentEmbed | null;
};

export type AgentEmbedAudience = 'public' | 'illinois';

export type AgentEmbed = {
  /** The link credential: `/embed/<key>`. */
  key: string;
  audience: AgentEmbedAudience;
  /** Shown as the agent's first message in every new embedded chat; `null` = agent stays silent. */
  greeting: string | null;
};

export type AgentEmbedSettings = {
  audience: AgentEmbedAudience;
  greeting: string | null;
};

export type AdminAgentEmbedResponse = {
  embed: AgentEmbed | null;
};

export type EmbedSessionAgent = {
  id: string;
  name: string;
  avatar: AgentAvatar | null;
  audience: AgentEmbedAudience;
  greeting: string | null;
};

export type EmbedSessionResponse = {
  agent: EmbedSessionAgent;
  /** `null` when the agent is Illinois-only and the visitor has not signed in yet. */
  token: string | null;
  user: { id: string; name: string; provider: string; embedAgentId: string | null } | null;
};

export type AdminAgentUsageResponse = {
  agents: AdminAgentUsage[];
};

export type AdminStudentUsage = AdminUsageCounts & {
  userId: string;
  name: string;
  email: string;
};

export type AdminAgentStudentUsageResponse = {
  agent_id: string;
  students: AdminStudentUsage[];
};

export type AdminAnalyticsBucket = {
  label: string;
  count: number;
};

export type AdminAnalyticsDailyPoint = {
  /** UTC date, `YYYY-MM-DD`. */
  date: string;
  conversationCount: number;
};

/** Class-wide activity for the dashboard's analytics section. Identifies no student. */
export type AdminAnalyticsResponse = {
  activeStudents: number;
  /** Class roster size; equals `activeStudents` when no class filter is applied. */
  enrolledStudents: number;
  conversationCount: number;
  medianTurns: number;
  /** Share of active students seen on two or more distinct days, 0–1. */
  returnRate: number;
  dailyActivity: AdminAnalyticsDailyPoint[];
  /** Conversations per student: "1", "2–4", "5–9", "10+". */
  reachBuckets: AdminAnalyticsBucket[];
  /** Turns per conversation: "1", "2", "3", "4–5", "6–9", "10+". */
  depthBuckets: AdminAnalyticsBucket[];
  /** Share of conversations that ended after one turn, 0–1. */
  oneTurnShare: number;
  /** Share of assistant messages that errored, 0–1. */
  errorRate: number;
};

/** What students ask: labels and counts only, from a sample of recent student messages. */
export type AdminTopicsResponse = {
  topics: { label: string; count: number }[];
  /** How many student messages the model grouped; 0 means none in the window. */
  sampleSize: number;
};

/** The caller's own analytics panel layout. Array order is the panel order. */
export type AdminDashboardLayoutResponse = {
  panels: AdminDashboardPanel[];
};

export interface MCPServerStatus {
  requiresOAuth: boolean;
  connectionState: 'disconnected' | 'connecting' | 'connected' | 'error';
}

export interface MCPConnectionStatusResponse {
  success: boolean;
  connectionStatus: Record<string, MCPServerStatus>;
  /** Server-configured OAuth completion window in ms (`MCP_OAUTH_HANDLING_TIMEOUT`) */
  oauthTimeout?: number;
}

export interface MCPServerConnectionStatusResponse {
  success: boolean;
  serverName: string;
  requiresOAuth: boolean;
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
}

export interface MCPAuthValuesResponse {
  success: boolean;
  serverName: string;
  authValueFlags: Record<string, boolean>;
}

/**
 * User Favorites — pinned agents, models, and model specs.
 * Exactly one variant should be set per entry; exclusivity is enforced
 * server-side in FavoritesController. Shape is loose for state-update ergonomics.
 */
export type TUserFavorite = {
  agentId?: string;
  model?: string;
  endpoint?: string;
  spec?: string;
};

/**
 * Tool favorites — starred marketplace items (built-in capabilities, plugin
 * tools, MCP servers, skills). Identity is the compound (itemType, itemId)
 * pair, matching the marketplace `itemKey` format `itemType:itemId`.
 */
export type TToolFavoriteType = 'builtin' | 'tool' | 'mcp' | 'skill';

export type TToolFavorite = {
  itemType: TToolFavoriteType;
  itemId: string;
};

/* SharePoint Graph API Token */
export type GraphTokenParams = {
  scopes: string;
};

export type GraphTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
};
