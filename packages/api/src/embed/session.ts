import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { SystemRoles } from 'librechat-data-provider';
import { logger } from '@librechat/data-schemas';
import type { IUser, IAgent, BalanceConfig, CreateUserRequest } from '@librechat/data-schemas';
import type { Types } from 'mongoose';
import type { Request, Response } from 'express';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Long enough that a visitor's tab survives a class period; the page re-mints on every load anyway. */
export const EMBED_TOKEN_EXPIRY_MS: number = DAY_MS;
const GUEST_PROVIDER = 'guest';

export interface EmbedSessionDeps {
  getAgentByEmbedKey: (key: string) => Promise<IAgent | null>;
  getUserById: (id: string, projection?: string) => Promise<IUser | null>;
  createUser: (
    data: CreateUserRequest,
    balance?: BalanceConfig,
    disableTTL?: boolean,
    returnUser?: boolean,
  ) => Promise<Types.ObjectId | Partial<IUser>>;
  generateToken: (user: IUser, expiresIn?: number) => Promise<string>;
  getBalanceConfig: () => Promise<BalanceConfig | undefined>;
  grantAgentView: (params: {
    userId: string;
    agentId: Types.ObjectId | string;
    grantedBy: Types.ObjectId | string;
  }) => Promise<unknown>;
}

interface EmbedAgentInfo {
  id: string;
  name: string;
  avatar: IAgent['avatar'] | null;
  audience: 'public' | 'illinois';
  greeting: string | null;
}

export interface EmbedSessionResponse {
  agent: EmbedAgentInfo;
  /** `null` when the agent is Illinois-only and the caller has not signed in yet. */
  token: string | null;
  user: { id: string; name: string; provider: string; embedAgentId: string | null } | null;
}

const toAgentInfo = (agent: IAgent): EmbedAgentInfo => ({
  id: agent.id,
  name: agent.name ?? '',
  avatar: agent.avatar ?? null,
  audience: agent.embed?.audience ?? 'public',
  greeting: agent.embed?.greeting ?? null,
});

const bearerFrom = (req: Request): string | null => {
  const header = req.headers.authorization;
  return typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : null;
};

const isGuestFor = (user: IUser, agentId: string): boolean =>
  user.provider === GUEST_PROVIDER && user.embedAgentId === agentId;

export function createEmbedSessionHandler(
  deps: EmbedSessionDeps,
): (req: Request, res: Response) => Promise<Response> {
  const { getAgentByEmbedKey, getUserById, createUser, generateToken, getBalanceConfig } = deps;

  /** A token the page still holds may be expired or belong to another agent's guest; both mean "no user". */
  async function userFromBearer(token: string | null): Promise<IUser | null> {
    if (!token || !process.env.JWT_SECRET) {
      return null;
    }
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      const id = typeof payload === 'object' && payload != null ? payload.id : null;
      return typeof id === 'string' ? await getUserById(id, '-password -__v -totpSecret') : null;
    } catch {
      return null;
    }
  }

  async function createGuest(agentId: string): Promise<IUser> {
    const uuid = randomUUID();
    const created = await createUser(
      {
        provider: GUEST_PROVIDER,
        email: `embed-${uuid}@gieschat.local`,
        username: `guest-${uuid.slice(0, 8)}`,
        name: 'Guest',
        role: SystemRoles.USER,
        emailVerified: true,
        embedAgentId: agentId,
      },
      await getBalanceConfig(),
      true,
      true,
    );
    return created as IUser;
  }

  return async function startEmbedSession(req: Request, res: Response): Promise<Response> {
    try {
      const key = String(req.params.key ?? '');
      const agent = key ? await getAgentByEmbedKey(key) : null;
      if (!agent) {
        return res.status(404).json({ error: 'This chat link is no longer active' });
      }
      const audience = agent.embed?.audience ?? 'public';
      const bearerUser = await userFromBearer(bearerFrom(req));

      if (
        audience === 'illinois' &&
        (bearerUser == null || bearerUser.provider === GUEST_PROVIDER)
      ) {
        const body: EmbedSessionResponse = { agent: toAgentInfo(agent), token: null, user: null };
        return res.status(200).json(body);
      }

      const reuse =
        bearerUser != null &&
        (audience === 'illinois'
          ? bearerUser.provider !== GUEST_PROVIDER
          : isGuestFor(bearerUser, agent.id));
      const user = reuse ? (bearerUser as IUser) : await createGuest(agent.id);
      const userId = String(user._id);

      await deps.grantAgentView({ userId, agentId: agent._id, grantedBy: agent.author });
      const token = await generateToken(user, EMBED_TOKEN_EXPIRY_MS);
      const body: EmbedSessionResponse = {
        agent: toAgentInfo(agent),
        token,
        user: {
          id: userId,
          name: user.name ?? '',
          provider: user.provider,
          embedAgentId: user.embedAgentId ?? null,
        },
      };
      return res.status(200).json(body);
    } catch (error) {
      logger.error('[embed] session error:', error);
      return res.status(500).json({ error: 'Failed to start embedded chat' });
    }
  };
}
