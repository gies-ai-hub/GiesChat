import { Document, Types } from 'mongoose';

/** Present on per-agent keys made in the dashboard; absent on upstream per-user keys. */
interface AgentKeyScope {
  agentId?: string;
  /** The site's Entra app (client) id; the key accepts only student ID tokens issued to it. */
  audience?: string;
}

export interface IAgentApiKey extends Document, AgentKeyScope {
  userId: Types.ObjectId;
  name: string;
  keyHash: string;
  keyPrefix: string;
  lastUsedAt?: Date;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  tenantId?: string;
  requestCount?: number;
}

export interface AgentApiKeyCreateData extends AgentKeyScope {
  userId: Types.ObjectId | string;
  name: string;
  expiresAt?: Date | null;
}

export interface AgentApiKeyCreateResult extends AgentKeyScope {
  id: string;
  name: string;
  keyPrefix: string;
  key: string;
  createdAt: Date;
  expiresAt?: Date;
}

export interface AgentApiKeyListItem extends AgentKeyScope {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt?: Date;
  expiresAt?: Date;
  createdAt: Date;
  requestCount?: number;
}

export interface AgentApiKeyValidation extends AgentKeyScope {
  userId: Types.ObjectId;
  keyId: Types.ObjectId;
  name: string;
}

export interface AgentApiKeyQuery {
  userId?: Types.ObjectId | string;
  keyPrefix?: string;
  id?: string;
}

export interface AgentApiKeyDeleteResult {
  deletedCount?: number;
}
