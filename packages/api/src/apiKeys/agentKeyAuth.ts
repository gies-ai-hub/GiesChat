import { logger } from '@librechat/data-schemas';
import { RETIRED_MODELS, SystemRoles } from 'librechat-data-provider';
import type { AgentApiKeyValidation, AppConfig, IUser } from '@librechat/data-schemas';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { JwtPayload } from 'jsonwebtoken';
import { getOpenIdEmail } from '../auth/openid';

/** The student's Illinois ID token, issued to the caller site's own Entra app. */
export const USER_TOKEN_HEADER = 'x-gieschat-user-token';
const DASHBOARD_ORIGIN = 'dashboard';
const AGENT_ID_PREFIX = 'agent_';

export interface AllowedModel {
  model: string;
  provider: string;
}

export interface AgentKeyContext {
  id: string;
  name: string;
  agentId: string;
  /** What the caller sent in `model`; `null` = the agent's own model. */
  requestedModel: string | null;
  /** The resolved override for this turn; `null` = the agent's own model. */
  model: AllowedModel | null;
  allowedModels: AllowedModel[];
}

export interface AgentKeyRequest extends Request {
  user?: IUser & { id: string };
  agentKey?: AgentKeyContext;
  config?: AppConfig;
}

export type AgentKeyMiddleware = (
  req: AgentKeyRequest,
  res: Response,
  next: NextFunction,
) => Promise<Response | void>;

export interface AgentKeyModelEntry {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
}

export interface AgentKeyAuthDeps {
  validateAgentApiKey: (apiKey: string) => Promise<AgentApiKeyValidation | null>;
  getAgent: (filter: { id: string }) => Promise<{
    _id: unknown;
    id: string;
    author?: unknown;
    createdVia?: string;
  } | null>;
  /** Verifies an ID token from GiesChat's tenant issued to `audience`; throws when it is not. */
  verifyUserToken: (token: string, audience: string) => Promise<JwtPayload>;
  findUser: (filter: Record<string, unknown>) => Promise<IUser | null>;
  createUser: (data: Partial<IUser>) => Promise<IUser>;
  /** Idempotent AGENT_VIEWER grant, as /embed gives its guests: lets the student open the chat. */
  grantAgentView: (params: {
    userId: string;
    agentDbId: unknown;
    grantedBy: string;
  }) => Promise<void>;
  /** GiesChat's own SSO issuer, stamped on accounts made here so the student's real sign-in links. */
  openidIssuer?: string;
}

export function sendApiError(
  res: Response,
  status: number,
  code: string,
  message: string,
  type = 'invalid_request_error',
): Response {
  return res.status(status).json({ error: { message, type, code } });
}

const isDuplicateKey = (error: unknown): boolean =>
  (error as { code?: number } | null)?.code === 11000;

/**
 * Matches by `oid`, the directory object id, which is the same for every Entra app; `sub`
 * differs per app, so it can never link a site's token to the GiesChat account.
 */
async function findOrCreateStudent(
  deps: AgentKeyAuthDeps,
  payload: JwtPayload,
  oid: string,
): Promise<IUser | null> {
  const byOid = await deps.findUser({ idOnTheSource: oid });
  if (byOid != null) {
    return byOid;
  }
  const email = getOpenIdEmail(payload, 'agentKeyAuth')?.trim().toLowerCase();
  if (!email) {
    return null;
  }
  const byEmail = await deps.findUser({ email });
  if (byEmail != null) {
    /** Same address on a different directory object is a different person: never merge. */
    return byEmail.idOnTheSource != null && byEmail.idOnTheSource !== oid ? null : byEmail;
  }
  try {
    /** No `openidId`: it is per app, so the student's first real sign-in fills in GiesChat's own. */
    return await deps.createUser({
      provider: 'openid',
      email,
      emailVerified: true,
      name: typeof payload.name === 'string' && payload.name ? payload.name : email,
      username: email.split('@')[0],
      idOnTheSource: oid,
      role: SystemRoles.USER,
      ...(deps.openidIssuer ? { openidIssuer: deps.openidIssuer } : {}),
    });
  } catch (error) {
    if (isDuplicateKey(error)) {
      return deps.findUser({ email });
    }
    throw error;
  }
}

/**
 * Per-agent keys only. Anything else (no bearer, an unknown key, an upstream per-user key)
 * falls through to upstream auth, which `interface.remoteAgents` keeps switched off.
 */
export function createAgentKeyAuth(deps: AgentKeyAuthDeps): AgentKeyMiddleware {
  return async (req, res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return next();
    }
    try {
      const key = await deps.validateAgentApiKey(header.slice(7).trim());
      if (key?.agentId == null) {
        return next();
      }

      const agent = await deps.getAgent({ id: key.agentId });
      if (agent == null || agent.createdVia !== DASHBOARD_ORIGIN) {
        return sendApiError(res, 401, 'invalid_api_key', "This key's agent no longer exists");
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const rawModel = typeof body.model === 'string' ? body.model.trim() : '';
      const requested = rawModel === '' || rawModel === key.agentId ? null : rawModel;
      if (requested?.startsWith(AGENT_ID_PREFIX)) {
        return sendApiError(
          res,
          403,
          'key_wrong_agent',
          'This key only works with its own agent',
          'permission_error',
        );
      }

      const token = req.headers[USER_TOKEN_HEADER];
      if (typeof token !== 'string' || token === '' || !key.audience) {
        return sendApiError(
          res,
          401,
          'invalid_user_token',
          "Send the student's Illinois ID token in the X-GiesChat-User-Token header",
        );
      }
      let payload: JwtPayload;
      try {
        payload = await deps.verifyUserToken(token, key.audience);
      } catch (error) {
        logger.warn(`[agentKeyAuth] student token rejected for key ${String(key.keyId)}`, error);
        return sendApiError(
          res,
          401,
          'invalid_user_token',
          'The student token is expired, or was not issued to the app this key accepts',
        );
      }
      const oid = typeof payload.oid === 'string' ? payload.oid : '';
      if (oid === '') {
        return sendApiError(res, 401, 'invalid_user_token', 'The student token has no oid claim');
      }

      const user = await findOrCreateStudent(deps, payload, oid);
      if (user == null) {
        return sendApiError(
          res,
          401,
          'invalid_user_token',
          'This Illinois account cannot be matched to a GiesChat user',
        );
      }
      const userId = String(user._id);
      await deps.grantAgentView({
        userId,
        agentDbId: agent._id,
        grantedBy: String(agent.author ?? userId),
      });

      user.id = userId;
      req.user = user as IUser & { id: string };
      /** The controllers keep reading the agent id from `model`; the override travels separately. */
      req.body = { ...body, model: key.agentId };
      req.agentKey = {
        id: String(key.keyId),
        name: key.name,
        agentId: key.agentId,
        requestedModel: requested,
        model: null,
        allowedModels: [],
      };
      return next();
    } catch (error) {
      logger.error('[agentKeyAuth] error authenticating agent key', error);
      return sendApiError(
        res,
        500,
        'internal_error',
        'Internal server error during authentication',
        'server_error',
      );
    }
  };
}

/** What the agent builder offers: configured models of the allowed providers, minus retired ones. */
export function resolveAllowedModels(
  modelsConfig: Record<string, string[] | undefined>,
  providers: string[],
): AllowedModel[] {
  const allowed: AllowedModel[] = [];
  for (const provider of providers.length > 0 ? providers : Object.keys(modelsConfig)) {
    for (const model of modelsConfig[provider] ?? []) {
      if (!RETIRED_MODELS.has(model)) {
        allowed.push({ model, provider });
      }
    }
  }
  return allowed;
}

/** Runs after `configMiddleware`, which the models config needs. */
export function createAgentKeyModel(deps: {
  getModelsConfig: (req: Request) => Promise<Record<string, string[] | undefined>>;
}): AgentKeyMiddleware {
  return async (req, res, next) => {
    const agentKey = req.agentKey;
    if (agentKey == null) {
      return next();
    }
    try {
      const providers = (req.config?.endpoints?.agents?.allowedProviders ?? []) as string[];
      agentKey.allowedModels = resolveAllowedModels(await deps.getModelsConfig(req), providers);
      if (agentKey.requestedModel != null) {
        const match = agentKey.allowedModels.find(
          (entry) => entry.model === agentKey.requestedModel,
        );
        if (match == null) {
          return sendApiError(
            res,
            404,
            'model_not_found',
            `Model not available: ${agentKey.requestedModel}. GET /v1/models lists the allowed models.`,
          );
        }
        agentKey.model = match;
      }
      return next();
    } catch (error) {
      logger.error('[agentKeyModel] error resolving models', error);
      return sendApiError(res, 500, 'internal_error', 'Could not load models', 'server_error');
    }
  };
}

export function skipIfAgentKey(handler: RequestHandler): RequestHandler {
  return (req, res, next) =>
    (req as AgentKeyRequest).agentKey != null ? next() : handler(req, res, next);
}

const toModelEntry = (entry: AllowedModel): AgentKeyModelEntry => ({
  id: entry.model,
  object: 'model',
  created: 0,
  owned_by: entry.provider,
});

/** `GET /v1/models` for an agent key: the models it may pick, never other agents. */
export function agentKeyModelList(agentKey: AgentKeyContext): {
  object: 'list';
  data: AgentKeyModelEntry[];
} {
  return { object: 'list', data: agentKey.allowedModels.map(toModelEntry) };
}

export function agentKeyModelEntry(
  agentKey: AgentKeyContext,
  model: string,
): AgentKeyModelEntry | null {
  const found = agentKey.allowedModels.find((entry) => entry.model === model);
  return found ? toModelEntry(found) : null;
}
