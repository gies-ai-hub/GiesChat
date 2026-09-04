import { Document, Types } from 'mongoose';
import type {
  GraphEdge,
  MemoryScope,
  AgentToolOptions,
  AgentToolResources,
  AgentSubagentsConfig,
} from 'librechat-data-provider';

export interface ISupportContact {
  name?: string;
  email?: string;
}

export type AgentEmbedAudience = 'public' | 'illinois';

export interface IAgentEmbed {
  /** Random link credential; `select: false` on the schema, so absent unless asked for. */
  key?: string;
  audience: AgentEmbedAudience;
  /** Shown as the agent's first message in every new embedded chat. */
  greeting?: string;
}

export interface IAgent extends Omit<Document, 'model'> {
  id: string;
  name?: string;
  description?: string;
  instructions?: string;
  avatar?: {
    filepath: string;
    source: string;
  };
  provider: string;
  model: string;
  model_parameters?: Record<string, unknown>;
  artifacts?: string;
  access_level?: number;
  recursion_limit?: number;
  tools?: string[];
  skills?: string[];
  skills_enabled?: boolean;
  tool_kwargs?: Array<unknown>;
  actions?: string[];
  author: Types.ObjectId;
  authorName?: string;
  hide_sequential_outputs?: boolean;
  end_after_tools?: boolean;
  stateful_code_sessions?: boolean;
  /** @deprecated Use edges instead */
  agent_ids?: string[];
  edges?: GraphEdge[];
  conversation_starters?: string[];
  tool_resources?: AgentToolResources;
  versions?: Omit<IAgent, 'versions'>[];
  category: string;
  /** Free-text course label shown on the professor dashboard. Display only. */
  course?: string;
  /** Which surface built this agent. A UI hint for filtering — never an access check. */
  createdVia?: string;
  /** Present only while the agent is embeddable without login; see `IAgentEmbed`. */
  embed?: IAgentEmbed;
  support_contact?: ISupportContact;
  is_promoted?: boolean;
  /** MCP server names extracted from tools for efficient querying */
  mcpServerNames?: string[];
  /** Per-tool configuration (defer_loading, allowed_callers) */
  tool_options?: AgentToolOptions;
  /** Subagent spawning configuration — isolated-context child agents. */
  subagents?: AgentSubagentsConfig;
  /** Memory partition: 'agent' isolates memories per (user, agent); default shared pool */
  memory_scope?: MemoryScope;
  tenantId?: string;
}
