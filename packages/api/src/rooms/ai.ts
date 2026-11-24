import mongoose from 'mongoose';
import { AI_MENTION_PATTERN, extractEnvVariable } from 'librechat-data-provider';
import { logger } from '@librechat/data-schemas';
import type { Model } from 'mongoose';
import type { AppConfig, IAgent, IRoom, IRoomMessage, IRoomPoll } from '@librechat/data-schemas';
import { getCustomEndpointConfig } from '~/app/config';
import { generateShortLivedToken } from '~/crypto/jwt';
import {
  getRoom,
  getClosedPolls,
  createAiMessage,
  getRecentMessages,
  postSystemMessage,
  updateMessageText,
} from './service';
import { publish } from './broadcast';

const TRANSCRIPT_MESSAGE_LIMIT = 30;
const CONTEXT_PROMPT_CAP = 20000;

export interface RoomPersona {
  instructions?: string;
  model?: string;
}

export interface ChatCompletionMessage {
  role: 'system' | 'user';
  content: string;
}

const DEFAULT_INSTRUCTIONS =
  'You are the AI collaborator in a shared GiesChat brainstorm room with multiple ' +
  'participants. Be concise and constructive: build on the ideas discussed, weigh ' +
  'trade-offs, and move the group forward. Messages are prefixed with the name of ' +
  'the participant who wrote them.';

export function detectAiMention(text: string): boolean {
  return AI_MENTION_PATTERN.test(text);
}

export async function getRoomPersona(agentId?: string): Promise<RoomPersona | null> {
  if (!agentId) {
    return null;
  }
  const Agent = mongoose.models.Agent as Model<IAgent>;
  const agent = await Agent.findOne({ id: agentId }).lean<IAgent>();
  if (!agent) {
    return null;
  }
  return { instructions: agent.instructions ?? undefined, model: agent.model };
}

const formatTranscript = (messages: IRoomMessage[]): string =>
  messages
    .slice(-TRANSCRIPT_MESSAGE_LIMIT)
    .filter((m) => m.kind !== 'system')
    .map((m) => `${m.authorName}: ${m.text}`)
    .join('\n');

export function buildRoomMessages(params: {
  room: Pick<IRoom, 'title' | 'contextText'>;
  persona: RoomPersona | null;
  history: IRoomMessage[];
  ragContext: string;
  authorName: string;
  question: string;
}): ChatCompletionMessage[] {
  const { room, persona, history, ragContext, authorName, question } = params;
  const sections = [persona?.instructions?.trim() || DEFAULT_INSTRUCTIONS];
  sections.push(`Room: ${room.title}`);
  if (room.contextText) {
    sections.push(
      `Background context shared with the room:\n${room.contextText.slice(0, CONTEXT_PROMPT_CAP)}`,
    );
  }
  if (ragContext !== '') {
    sections.push(`Relevant excerpts from files attached to the room:\n${ragContext}`);
  }
  const transcript = formatTranscript(history);
  const userContent =
    (transcript === '' ? '' : `Discussion so far:\n${transcript}\n\n`) +
    `${authorName} asked: ${question}`;
  return [
    { role: 'system', content: sections.join('\n\n') },
    { role: 'user', content: userContent },
  ];
}

export const voteChoices = (votes: IRoomPoll['votes']): number[] =>
  votes instanceof Map ? [...votes.values()] : Object.values(votes ?? {});

export const countVotes = (poll: IRoomPoll): number[] => {
  const choices = voteChoices(poll.votes);
  return poll.options.map((_, idx) => choices.filter((choice) => choice === idx).length);
};

const formatPollResults = (polls: IRoomPoll[]): string =>
  polls
    .filter((p) => p.status === 'closed')
    .map((poll) => {
      const counts = countVotes(poll).map((count, idx) => `${poll.options[idx]}: ${count}`);
      return `Poll "${poll.question}" — ${counts.join(', ')}`;
    })
    .join('\n');

export function buildSummarizeMessages(params: {
  roomTitle: string;
  history: IRoomMessage[];
  polls: IRoomPoll[];
}): ChatCompletionMessage[] {
  const { roomTitle, history, polls } = params;
  const transcript = history
    .filter((m) => m.kind !== 'system')
    .map((m) => `${m.authorName}: ${m.text}`)
    .join('\n');
  const pollResults = formatPollResults(polls);
  const content =
    `Summarize this brainstorm discussion from the room "${roomTitle}".\n` +
    'Structure the recap as: Themes, Decisions (including poll results), Open questions.\n\n' +
    `Discussion:\n${transcript}` +
    (pollResults === '' ? '' : `\n\nClosed polls:\n${pollResults}`);
  return [
    {
      role: 'system',
      content:
        'You recap group brainstorm discussions concisely for students. Use short markdown sections.',
    },
    { role: 'user', content },
  ];
}

const ROOM_AI_ENDPOINT = 'Azure OpenAI';
const FLUSH_INTERVAL_MS = 1000;
const SUMMARIZE_HISTORY_LIMIT = 200;

export interface RoomEndpoint {
  baseURL: string;
  apiKey: string;
  defaultModel: string;
}

const isResolved = (value: string) => value !== '' && !value.startsWith('${');

export function resolveRoomEndpoint(appConfig: AppConfig): RoomEndpoint | null {
  const endpointConfig = getCustomEndpointConfig({ endpoint: ROOM_AI_ENDPOINT, appConfig });
  const defaultModel =
    typeof endpointConfig?.models?.default?.[0] === 'string'
      ? endpointConfig.models.default[0]
      : 'gpt-6-luna';
  if (endpointConfig?.baseURL && endpointConfig.apiKey) {
    const apiKey = extractEnvVariable(endpointConfig.apiKey);
    if (isResolved(apiKey)) {
      return { baseURL: extractEnvVariable(endpointConfig.baseURL), apiKey, defaultModel };
    }
  }
  /* ponytail: local dev fallback — Azure key is a prod app setting; use the plain OpenAI key */
  const openAiKey = process.env.OPENAI_API_KEY ?? '';
  if (isResolved(openAiKey)) {
    return { baseURL: 'https://api.openai.com/v1', apiKey: openAiKey, defaultModel };
  }
  return null;
}

export type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;

export async function streamChatCompletion(params: {
  endpoint: RoomEndpoint;
  model: string;
  messages: ChatCompletionMessage[];
  onDelta: (delta: string) => void;
  fetchImpl?: FetchImpl;
}): Promise<string> {
  const { endpoint, model, messages, onDelta } = params;
  const fetchImpl = params.fetchImpl ?? (fetch as FetchImpl);
  const res = await fetchImpl(`${endpoint.baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${endpoint.apiKey}`,
      'api-key': endpoint.apiKey,
    },
    body: JSON.stringify({ model, messages, stream: true }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`room AI endpoint responded ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const payload = line.startsWith('data: ') ? line.slice(6).trim() : null;
      if (!payload || payload === '[DONE]') {
        continue;
      }
      const delta: string | undefined = JSON.parse(payload).choices?.[0]?.delta?.content;
      if (delta) {
        text += delta;
        onDelta(delta);
      }
    }
  }
  return text;
}

const PROMPT_DRAFT_CAP = 20000;

const PROMPT_DRAFT_SYSTEM =
  'You write system prompts for an AI facilitator that joins a group brainstorm room ' +
  'of business students. Given the room title and optional rough notes from the organizer, ' +
  'write a professional system prompt covering: the facilitator role, the topic and goals ' +
  'of the session, how to guide the discussion (build on ideas, weigh trade-offs, keep the ' +
  'group moving), and any constraints from the notes. Refine the notes rather than ' +
  'discarding them. Respond with ONLY the prompt text — no headings, no markdown fences, ' +
  'no commentary.';

export function promptDraftMessages(params: {
  title: string;
  notes?: string;
}): ChatCompletionMessage[] {
  const { title, notes } = params;
  const sections = [`Room title: ${title}`];
  const trimmed = notes?.trim() ?? '';
  if (trimmed !== '') {
    sections.push(`Organizer notes (rough, refine these):\n${trimmed.slice(0, PROMPT_DRAFT_CAP)}`);
  }
  sections.push('Write the facilitator system prompt now.');
  return [
    { role: 'system', content: PROMPT_DRAFT_SYSTEM },
    { role: 'user', content: sections.join('\n\n') },
  ];
}

export async function draftRoomPrompt(params: {
  title: string;
  notes?: string;
  appConfig: AppConfig;
  fetchImpl?: FetchImpl;
}): Promise<string> {
  const { title, notes, appConfig, fetchImpl } = params;
  const endpoint = resolveRoomEndpoint(appConfig);
  if (!endpoint) {
    throw new Error('room AI endpoint is not configured');
  }
  const text = await streamChatCompletion({
    endpoint,
    model: endpoint.defaultModel,
    messages: promptDraftMessages({ title, notes }),
    fetchImpl,
    onDelta: () => undefined,
  });
  return text.trim().slice(0, PROMPT_DRAFT_CAP);
}

const RAG_CHUNKS_PER_FILE = 5;
const RAG_CHUNK_LIMIT = 8;

type RagHit = [{ page_content: string; metadata: { source: string } }, number];

/** Retrieves relevant chunks from the room's files via the RAG API; degrades to '' on any failure. */
export async function queryRoomFiles(params: {
  userId: string;
  fileIds: string[];
  query: string;
  fetchImpl?: FetchImpl;
}): Promise<string> {
  const { userId, fileIds, query } = params;
  const ragUrl = process.env.RAG_API_URL;
  if (fileIds.length === 0 || !ragUrl) {
    return '';
  }
  const fetchImpl = params.fetchImpl ?? (fetch as FetchImpl);
  try {
    const jwtToken = generateShortLivedToken(userId);
    const responses = await Promise.all(
      fileIds.map(async (fileId) => {
        try {
          const res = await fetchImpl(`${ragUrl}/query`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${jwtToken}`,
            },
            body: JSON.stringify({ file_id: fileId, query, k: RAG_CHUNKS_PER_FILE }),
          });
          if (!res.ok) {
            return [];
          }
          return (await res.json()) as RagHit[];
        } catch {
          return [];
        }
      }),
    );
    return responses
      .flat()
      .sort((a, b) => a[1] - b[1])
      .slice(0, RAG_CHUNK_LIMIT)
      .map(([doc]) => doc.page_content)
      .join('\n---\n');
  } catch (error) {
    logger.warn('[rooms] RAG retrieval failed; answering without file context', error);
    return '';
  }
}

const aiLocks = new Set<string>();

export async function runAiReply(params: {
  roomId: string;
  appConfig: AppConfig;
  authorName: string;
  question: string;
  userId: string;
  fetchImpl?: FetchImpl;
}): Promise<void> {
  const { roomId, appConfig, authorName, question, userId, fetchImpl } = params;
  if (aiLocks.has(roomId)) {
    const note = await postSystemMessage(roomId, 'The AI is already replying — one at a time.');
    publish(roomId, 'message', note);
    return;
  }
  aiLocks.add(roomId);
  let placeholder: IRoomMessage | null = null;
  let text = '';
  try {
    const endpoint = resolveRoomEndpoint(appConfig);
    if (!endpoint) {
      throw new Error('room AI endpoint is not configured');
    }
    const room = await getRoom(roomId);
    const persona = await getRoomPersona(room.agentId);
    const history = await getRecentMessages(roomId, 30);
    const ragContext = await queryRoomFiles({ userId, fileIds: room.fileIds, query: question });
    const messages = buildRoomMessages({
      room,
      persona,
      history,
      ragContext,
      authorName,
      question,
    });

    const created = await createAiMessage(roomId, '');
    const aiMessage: IRoomMessage = created.toObject ? created.toObject() : created;
    placeholder = aiMessage;
    publish(roomId, 'message', aiMessage);

    let lastFlush = Date.now();
    const final = await streamChatCompletion({
      endpoint,
      model: persona?.model ?? endpoint.defaultModel,
      messages,
      fetchImpl,
      onDelta: (delta) => {
        text += delta;
        publish(roomId, 'ai_delta', { messageId: placeholder?.messageId, delta });
        const now = Date.now();
        if (now - lastFlush >= FLUSH_INTERVAL_MS) {
          lastFlush = now;
          void updateMessageText(placeholder?.messageId ?? '', text);
        }
      },
    });
    await updateMessageText(aiMessage.messageId, final);
    publish(roomId, 'message', { ...aiMessage, text: final });
  } catch (error) {
    logger.error('[rooms] AI reply failed', error);
    if (placeholder) {
      await updateMessageText(placeholder.messageId, text);
    }
    const note = await postSystemMessage(
      roomId,
      'AI reply was interrupted — mention @ai to retry.',
    );
    publish(roomId, 'message', note);
  } finally {
    aiLocks.delete(roomId);
  }
}

export async function summarizeRoom(params: {
  roomId: string;
  scope: 'room' | 'me';
  appConfig: AppConfig;
  fetchImpl?: FetchImpl;
}): Promise<{ text?: string; message?: IRoomMessage }> {
  const { roomId, scope, appConfig, fetchImpl } = params;
  const endpoint = resolveRoomEndpoint(appConfig);
  if (!endpoint) {
    throw new Error('room AI endpoint is not configured');
  }
  const room = await getRoom(roomId);
  const history = await getRecentMessages(roomId, SUMMARIZE_HISTORY_LIMIT);
  const polls = await getClosedPolls(roomId);
  const messages = buildSummarizeMessages({ roomTitle: room.title, history, polls });
  const text = await streamChatCompletion({
    endpoint,
    model: endpoint.defaultModel,
    messages,
    fetchImpl,
    onDelta: () => undefined,
  });
  if (scope === 'me') {
    return { text };
  }
  const message = await createAiMessage(roomId, text);
  publish(roomId, 'message', message);
  return { message };
}
