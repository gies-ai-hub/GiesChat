/**
 * What an anonymous embed guest may call. Everything not listed answers 403 — the
 * guest token is otherwise a free GiesChat account. Reads are prefix-allowed so the
 * chat shell boots; writes are limited to the chat itself and the guest's own
 * conversations and messages, which are already scoped per user downstream.
 */
const READ_PREFIXES = [
  '/api/user',
  '/api/config',
  '/api/endpoints',
  '/api/models',
  '/api/banner',
  '/api/roles',
  '/api/presets',
  '/api/search',
  '/api/agents',
  '/api/convos',
  '/api/messages',
  '/api/files/config',
  '/api/tags',
  '/api/balance',
  '/api/keys',
];
const WRITE_PREFIXES = ['/api/convos', '/api/messages', '/api/auth/logout'];
const CHAT_PREFIX = '/api/agents/chat';
/** Stream subscription, abort, and resume carry no `agent_id`; they act on the guest's own run. */
const CHAT_RUN_CONTROL = [`${CHAT_PREFIX}/abort`, `${CHAT_PREFIX}/resume`, `${CHAT_PREFIX}/stream`];

const matchesPrefix = (path: string, prefix: string): boolean =>
  path === prefix || path.startsWith(`${prefix}/`);

export interface EmbedRequest {
  method: string;
  /** Full request URL, query string included (`req.originalUrl`). */
  url: string;
  /** The single agent the guest is fenced to. */
  agentId: string;
  /** `agent_id` from the request body, when any. */
  bodyAgentId?: unknown;
}

export function isEmbedRequestAllowed({
  method,
  url,
  agentId,
  bodyAgentId,
}: EmbedRequest): boolean {
  const path = url.split(/[?#]/)[0] ?? '';
  if (matchesPrefix(path, CHAT_PREFIX)) {
    return CHAT_RUN_CONTROL.some((p) => matchesPrefix(path, p)) || bodyAgentId === agentId;
  }
  const prefixes = method.toUpperCase() === 'GET' ? READ_PREFIXES : WRITE_PREFIXES;
  return prefixes.some((prefix) => matchesPrefix(path, prefix));
}
