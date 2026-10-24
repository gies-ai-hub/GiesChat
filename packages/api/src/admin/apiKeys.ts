import { logger, isValidObjectIdString } from '@librechat/data-schemas';
import type { AdminAgentApiKey } from 'librechat-data-provider';
import type {
  IAgent,
  IUser,
  AgentApiKeyListItem,
  AgentApiKeyCreateData,
  AgentApiKeyCreateResult,
} from '@librechat/data-schemas';
import type { FilterQuery } from 'mongoose';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';

export interface AdminApiKeyDeps {
  findAgents: (
    filter: FilterQuery<IAgent>,
    fieldsToSelect?: string | string[] | null,
  ) => Promise<IAgent[]>;
  createAgentApiKey: (data: AgentApiKeyCreateData) => Promise<AgentApiKeyCreateResult>;
  listAgentApiKeysForAgents: (agentIds: string[]) => Promise<AgentApiKeyListItem[]>;
  deleteAgentApiKeyForAgents: (keyId: string, agentIds: string[]) => Promise<boolean>;
}

type Handler = (req: ServerRequest, res: Response) => Promise<Response>;

export interface AdminApiKeyHandlers {
  listApiKeys: Handler;
  createApiKey: Handler;
  revokeApiKey: Handler;
}

const DASHBOARD_ORIGIN = 'dashboard';
const NAME_MAX = 100;
/** An Entra application (client) id. */
const APP_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const iso = (date?: Date | null): string | null => (date ? new Date(date).toISOString() : null);

export function toApiKeyItem(key: AgentApiKeyListItem): AdminAgentApiKey {
  return {
    id: key.id,
    agentId: key.agentId ?? '',
    name: key.name,
    keyPrefix: key.keyPrefix,
    audience: key.audience ?? '',
    lastUsedAt: iso(key.lastUsedAt),
    requestCount: key.requestCount ?? 0,
    createdAt: iso(key.createdAt) ?? '',
  };
}

export function createAdminApiKeyHandlers(deps: AdminApiKeyDeps): AdminApiKeyHandlers {
  /**
   * Keys are an author/co-admin decision. Collaborators and EDIT shares can see an agent's
   * analytics but never mint or revoke its keys.
   */
  async function managedAgentIds(caller: IUser, agentId?: string): Promise<string[]> {
    const callerId = String(caller._id);
    const agents = await deps.findAgents(
      {
        createdVia: DASHBOARD_ORIGIN,
        draftOf: { $exists: false },
        ...(agentId === undefined ? {} : { id: agentId }),
        $or: [{ author: callerId }, { coAdmins: callerId }],
      },
      'id',
    );
    return agents.map((agent) => agent.id);
  }

  async function listApiKeys(req: ServerRequest, res: Response): Promise<Response> {
    if (req.user == null) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
      const keys = await deps.listAgentApiKeysForAgents(await managedAgentIds(req.user));
      return res.status(200).json({ keys: keys.map(toApiKeyItem) });
    } catch (error) {
      logger.error('[adminApiKeys] list error:', error);
      return res.status(500).json({ error: 'Failed to load API keys' });
    }
  }

  async function createApiKey(req: ServerRequest, res: Response): Promise<Response> {
    const agentId = (req.params as { agent_id?: unknown }).agent_id;
    if (typeof agentId !== 'string') {
      return res.status(400).json({ error: 'agent_id is required' });
    }
    if (req.user == null) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const body = (req.body ?? {}) as { name?: unknown; audience?: unknown };
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name === '' || name.length > NAME_MAX) {
      return res
        .status(400)
        .json({ error: `Name must be 1 to ${NAME_MAX} characters`, field: 'name' });
    }
    const audience = typeof body.audience === 'string' ? body.audience.trim().toLowerCase() : '';
    if (!APP_ID_PATTERN.test(audience)) {
      return res
        .status(400)
        .json({ error: 'Audience must be an Entra application (client) id', field: 'audience' });
    }
    try {
      const [managed] = await managedAgentIds(req.user, agentId);
      if (managed === undefined) {
        return res.status(404).json({ error: 'Agent not found' });
      }
      const created = await deps.createAgentApiKey({
        userId: String(req.user._id),
        name,
        agentId,
        audience,
      });
      return res
        .status(201)
        .json({ key: created.key, apiKey: toApiKeyItem({ ...created, requestCount: 0 }) });
    } catch (error) {
      logger.error('[adminApiKeys] create error:', error);
      return res.status(500).json({ error: 'Failed to create API key' });
    }
  }

  async function revokeApiKey(req: ServerRequest, res: Response): Promise<Response> {
    const keyId = (req.params as { key_id?: unknown }).key_id;
    if (req.user == null) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (typeof keyId !== 'string' || !isValidObjectIdString(keyId)) {
      return res.status(404).json({ error: 'API key not found' });
    }
    try {
      const deleted = await deps.deleteAgentApiKeyForAgents(keyId, await managedAgentIds(req.user));
      return deleted
        ? res.status(200).json({ deleted: true })
        : res.status(404).json({ error: 'API key not found' });
    } catch (error) {
      logger.error('[adminApiKeys] revoke error:', error);
      return res.status(500).json({ error: 'Failed to revoke API key' });
    }
  }

  return { listApiKeys, createApiKey, revokeApiKey };
}
