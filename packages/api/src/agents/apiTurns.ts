import { randomUUID } from 'node:crypto';
import { Constants, EModelEndpoint } from 'librechat-data-provider';
import type { IMessage } from '@librechat/data-schemas';
import type { AllowedModel } from '~/apiKeys/agentKeyAuth';

type StoredMessage = Pick<IMessage, 'messageId' | 'conversationId' | 'isCreatedByUser' | 'text'> & {
  content?: unknown;
};

export interface ApiTurnDeps {
  getConvo: (user: string, conversationId: string) => Promise<{ apiKeyId?: string } | null>;
  getMessages: (filter: Record<string, unknown>, select?: string) => Promise<StoredMessage[]>;
  saveMessage: (
    ctx: { userId: string },
    message: Partial<IMessage>,
    metadata?: { context?: string },
  ) => Promise<unknown>;
  saveConvo: (
    ctx: { userId: string },
    convo: { conversationId: string; [key: string]: unknown },
    metadata?: { context?: string },
  ) => Promise<unknown>;
}

export interface ApiConversation {
  conversationId: string;
  isNew: boolean;
  /** Saved turns, oldest first, ready for `formatAgentMessages`. */
  history: { role: 'user' | 'assistant'; content: string }[];
  /** Where the next student message hangs: the last saved message, or the root. */
  parentMessageId: string;
}

export interface ApiTurn {
  userId: string;
  conversation: ApiConversation;
  agentId: string;
  agentName: string;
  key: { id: string; name: string };
  model: string;
  userText: string;
  replyText: string;
  replyMessageId: string;
  /** The run failed: the reply holds the error text and counts toward the dashboard error rate. */
  error?: boolean;
}

const TITLE_LENGTH = 60;
const NO_PARENT = Constants.NO_PARENT as string;

/** Text of a message `content`: a string, or the text of its text parts. */
export function contentText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((part) => {
      const text = (part as { text?: unknown } | null)?.text;
      if (typeof text === 'string') {
        return text;
      }
      const value = (text as { value?: unknown } | undefined)?.value;
      return typeof value === 'string' ? value : '';
    })
    .join('');
}

/** A GiesChat agent reply keeps its words in `content` parts and may leave `text` empty. */
const messageText = (message: StoredMessage): string =>
  message.text ? message.text : contentText(message.content);

/** The text of a Responses API response's `output_text` parts. */
export function outputText(response: { output?: unknown[] }): string {
  let text = '';
  for (const item of response.output ?? []) {
    const { type, content } = item as {
      type?: string;
      content?: { type?: string; text?: string }[];
    };
    if (type !== 'message' || !Array.isArray(content)) {
      continue;
    }
    for (const part of content) {
      if (part.type === 'output_text' && typeof part.text === 'string') {
        text += part.text;
      }
    }
  }
  return text;
}

/**
 * Opens the conversation an agent-key request continues, or starts one. `id` is a
 * conversation id (Chat Completions) or any response id in it (Responses API, which
 * sends the latest `response.id`). Only conversations this key started resolve, so a site
 * can never read or extend a student's own GiesChat chats.
 * ponytail: history is the whole conversation, oldest first; make it branch-aware if a
 * caller ever continues from an older response on purpose.
 */
export async function openApiConversation(
  deps: ApiTurnDeps,
  { userId, keyId, id }: { userId: string; keyId: string; id?: string | null },
): Promise<ApiConversation | null> {
  if (id == null) {
    return {
      conversationId: randomUUID(),
      isNew: true,
      history: [],
      parentMessageId: NO_PARENT,
    };
  }
  const [response] = await deps.getMessages({ user: userId, messageId: id }, 'conversationId');
  const conversationId = response?.conversationId ?? id;
  const convo = await deps.getConvo(userId, conversationId);
  if (convo == null || convo.apiKeyId !== keyId) {
    return null;
  }
  const messages = await deps.getMessages(
    { user: userId, conversationId },
    'messageId isCreatedByUser text content',
  );
  return {
    conversationId,
    isNew: false,
    history: messages.map((message) => ({
      role: message.isCreatedByUser ? 'user' : 'assistant',
      content: messageText(message),
    })),
    parentMessageId: messages[messages.length - 1]?.messageId ?? NO_PARENT,
  };
}

/**
 * The only caller text an agent-key turn uses. History comes from saved messages, so caller
 * `system` messages and invented `assistant` turns never reach the model.
 */
export function lastUserMessage<T extends { role?: unknown }>(messages: T[]): T | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === 'user') {
      return messages[index];
    }
  }
  return null;
}

/** Agent-key calls never connect MCP servers: several run on the student's own accounts. */
export function withoutMcpTools<T extends { tools?: string[] }>(agent: T): T {
  return {
    ...agent,
    tools: (agent.tools ?? []).filter((tool) => !tool.includes(Constants.mcp_delimiter)),
  };
}

/** Runs the agent on `override` for this turn. A provider switch drops provider-specific settings. */
export function withModel<
  T extends { provider?: string; model?: string; model_parameters?: Record<string, unknown> },
>(agent: T, override: AllowedModel | null): T {
  if (override == null) {
    return agent;
  }
  const kept = agent.provider === override.provider ? agent.model_parameters : {};
  return {
    ...agent,
    provider: override.provider,
    model: override.model,
    model_parameters: { ...kept, model: override.model },
  };
}

const titleFrom = (text: string): string =>
  text.replace(/\s+/g, ' ').trim().slice(0, TITLE_LENGTH).trim() || 'API chat';

/**
 * Saves one agent-key turn: the student's message, then the reply threaded under it, then
 * the conversation (which reads its message list, so it goes last). Callers save before the
 * final response so the site's next call always finds this turn.
 */
export async function saveAgentApiTurn(deps: ApiTurnDeps, turn: ApiTurn): Promise<void> {
  const ctx = { userId: turn.userId };
  const { conversationId } = turn.conversation;
  const userMessageId = randomUUID();
  await deps.saveMessage(
    ctx,
    {
      messageId: userMessageId,
      conversationId,
      parentMessageId: turn.conversation.parentMessageId,
      isCreatedByUser: true,
      sender: 'User',
      text: turn.userText,
      endpoint: EModelEndpoint.agents,
      model: turn.agentId,
    },
    { context: 'agent API: student message' },
  );
  await deps.saveMessage(
    ctx,
    {
      messageId: turn.replyMessageId,
      conversationId,
      parentMessageId: userMessageId,
      isCreatedByUser: false,
      sender: turn.agentName,
      text: turn.replyText,
      endpoint: EModelEndpoint.agents,
      model: turn.agentId,
      ...(turn.error === true ? { error: true } : {}),
    },
    { context: 'agent API: reply' },
  );
  await deps.saveConvo(
    ctx,
    {
      conversationId,
      endpoint: EModelEndpoint.agents,
      agent_id: turn.agentId,
      model: turn.model,
      apiKeyId: turn.key.id,
      apiKeyName: turn.key.name,
      ...(turn.conversation.isNew ? { title: titleFrom(turn.userText) } : {}),
    },
    { context: 'agent API: conversation' },
  );
}
