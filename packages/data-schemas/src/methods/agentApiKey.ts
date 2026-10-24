import type { Types } from 'mongoose';
import type {
  AgentApiKeyCreateResult,
  AgentApiKeyCreateData,
  AgentApiKeyValidation,
  AgentApiKeyListItem,
  IAgentApiKey,
} from '~/types';
import { hashToken, getRandomValues } from '~/crypto';
import logger from '~/config/winston';

const API_KEY_PREFIX = 'sk-';
const API_KEY_LENGTH = 32;

/** Upstream's per-user reads must never see a dashboard agent's keys. */
const PER_USER = { agentId: { $exists: false } };

function toListItem(key: IAgentApiKey): AgentApiKeyListItem {
  return {
    id: (key._id as Types.ObjectId).toString(),
    name: key.name,
    keyPrefix: key.keyPrefix,
    lastUsedAt: key.lastUsedAt,
    expiresAt: key.expiresAt,
    createdAt: key.createdAt,
    agentId: key.agentId,
    audience: key.audience,
    requestCount: key.requestCount ?? 0,
  };
}

export function createAgentApiKeyMethods(mongoose: typeof import('mongoose')): {
  createAgentApiKey: (data: AgentApiKeyCreateData) => Promise<AgentApiKeyCreateResult>;
  validateAgentApiKey: (apiKey: string) => Promise<AgentApiKeyValidation | null>;
  listAgentApiKeys: (userId: string | Types.ObjectId) => Promise<AgentApiKeyListItem[]>;
  deleteAgentApiKey: (
    keyId: string | Types.ObjectId,
    userId: string | Types.ObjectId,
  ) => Promise<boolean>;
  deleteAllAgentApiKeys: (userId: string | Types.ObjectId) => Promise<number>;
  getAgentApiKeyById: (
    keyId: string | Types.ObjectId,
    userId: string | Types.ObjectId,
  ) => Promise<AgentApiKeyListItem | null>;
  listAgentApiKeysForAgents: (agentIds: string[]) => Promise<AgentApiKeyListItem[]>;
  deleteAgentApiKeyForAgents: (keyId: string, agentIds: string[]) => Promise<boolean>;
} {
  async function generateApiKey(): Promise<{ key: string; keyHash: string; keyPrefix: string }> {
    const randomPart = await getRandomValues(API_KEY_LENGTH);
    const key = `${API_KEY_PREFIX}${randomPart}`;
    const keyHash = await hashToken(key);
    const keyPrefix = key.slice(0, 8);
    return { key, keyHash, keyPrefix };
  }

  async function createAgentApiKey(data: AgentApiKeyCreateData): Promise<AgentApiKeyCreateResult> {
    try {
      const AgentApiKey = mongoose.models.AgentApiKey;
      const { key, keyHash, keyPrefix } = await generateApiKey();

      const apiKeyDoc = await AgentApiKey.create({
        userId: data.userId,
        name: data.name,
        keyHash,
        keyPrefix,
        expiresAt: data.expiresAt || undefined,
        agentId: data.agentId,
        audience: data.audience,
      });

      return {
        id: apiKeyDoc._id.toString(),
        name: apiKeyDoc.name,
        keyPrefix,
        key,
        createdAt: apiKeyDoc.createdAt,
        expiresAt: apiKeyDoc.expiresAt,
        agentId: apiKeyDoc.agentId,
        audience: apiKeyDoc.audience,
      };
    } catch (error) {
      logger.error('[createAgentApiKey] Error creating API key:', error);
      throw error;
    }
  }

  async function validateAgentApiKey(apiKey: string): Promise<AgentApiKeyValidation | null> {
    try {
      const AgentApiKey = mongoose.models.AgentApiKey;
      const keyHash = await hashToken(apiKey);

      const keyDoc = (await AgentApiKey.findOne({ keyHash }).lean()) as IAgentApiKey | null;

      if (!keyDoc) {
        return null;
      }

      if (keyDoc.expiresAt && new Date(keyDoc.expiresAt) < new Date()) {
        return null;
      }

      await AgentApiKey.updateOne(
        { _id: keyDoc._id },
        { $set: { lastUsedAt: new Date() }, $inc: { requestCount: 1 } },
      );

      return {
        userId: keyDoc.userId,
        keyId: keyDoc._id as Types.ObjectId,
        name: keyDoc.name,
        agentId: keyDoc.agentId,
        audience: keyDoc.audience,
      };
    } catch (error) {
      logger.error('[validateAgentApiKey] Error validating API key:', error);
      return null;
    }
  }

  async function listAgentApiKeys(userId: string | Types.ObjectId): Promise<AgentApiKeyListItem[]> {
    try {
      const AgentApiKey = mongoose.models.AgentApiKey;
      const keys = (await AgentApiKey.find({ userId, ...PER_USER })
        .sort({ createdAt: -1 })
        .lean()) as unknown as IAgentApiKey[];

      return keys.map(toListItem);
    } catch (error) {
      logger.error('[listAgentApiKeys] Error listing API keys:', error);
      throw error;
    }
  }

  async function deleteAgentApiKey(
    keyId: string | Types.ObjectId,
    userId: string | Types.ObjectId,
  ): Promise<boolean> {
    try {
      const AgentApiKey = mongoose.models.AgentApiKey;
      const result = await AgentApiKey.deleteOne({ _id: keyId, userId, ...PER_USER });
      return result.deletedCount > 0;
    } catch (error) {
      logger.error('[deleteAgentApiKey] Error deleting API key:', error);
      throw error;
    }
  }

  async function deleteAllAgentApiKeys(userId: string | Types.ObjectId): Promise<number> {
    try {
      const AgentApiKey = mongoose.models.AgentApiKey;
      const result = await AgentApiKey.deleteMany({ userId });
      return result.deletedCount;
    } catch (error) {
      logger.error('[deleteAllAgentApiKeys] Error deleting all API keys:', error);
      throw error;
    }
  }

  async function getAgentApiKeyById(
    keyId: string | Types.ObjectId,
    userId: string | Types.ObjectId,
  ): Promise<AgentApiKeyListItem | null> {
    try {
      const AgentApiKey = mongoose.models.AgentApiKey;
      const keyDoc = (await AgentApiKey.findOne({
        _id: keyId,
        userId,
        ...PER_USER,
      }).lean()) as IAgentApiKey | null;

      return keyDoc ? toListItem(keyDoc) : null;
    } catch (error) {
      logger.error('[getAgentApiKeyById] Error getting API key:', error);
      throw error;
    }
  }

  async function listAgentApiKeysForAgents(agentIds: string[]): Promise<AgentApiKeyListItem[]> {
    if (agentIds.length === 0) {
      return [];
    }
    const AgentApiKey = mongoose.models.AgentApiKey;
    const keys = (await AgentApiKey.find({ agentId: { $in: agentIds } })
      .sort({ createdAt: -1 })
      .lean()) as unknown as IAgentApiKey[];
    return keys.map(toListItem);
  }

  /** `keyId` must already be a valid ObjectId string; the caller checks. */
  async function deleteAgentApiKeyForAgents(keyId: string, agentIds: string[]): Promise<boolean> {
    const AgentApiKey = mongoose.models.AgentApiKey;
    const result = await AgentApiKey.deleteOne({ _id: keyId, agentId: { $in: agentIds } });
    return result.deletedCount > 0;
  }

  return {
    createAgentApiKey,
    validateAgentApiKey,
    listAgentApiKeys,
    deleteAgentApiKey,
    deleteAllAgentApiKeys,
    getAgentApiKeyById,
    listAgentApiKeysForAgents,
    deleteAgentApiKeyForAgents,
  };
}

export type AgentApiKeyMethods = ReturnType<typeof createAgentApiKeyMethods>;
