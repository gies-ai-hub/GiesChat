import { logger } from '@librechat/data-schemas';
import { EModelEndpoint, extractEnvVariable } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type {
  AdminModelTestAnswer,
  AdminModelTestResult,
  AdminModelTestRequest,
} from 'librechat-data-provider';
import { generateShortLivedToken } from '~/crypto/jwt';

export const MODEL_TEST_ENDPOINT = 'Azure OpenAI';
export const MODEL_TEST_MAX_QUESTIONS = 5;
const QUESTION_MAX = 500;
const INSTRUCTIONS_MAX = 20000;
const ANSWER_MAX_TOKENS = 1500;
const CALL_TIMEOUT_MS = 90_000;
const PASSAGES_PER_QUESTION = 8;

export interface ModelTestEndpoint {
  baseURL: string;
  apiKey: string;
  models: string[];
}

export interface ModelTestInput {
  agentId?: string;
  instructions: string;
  models: [string, string];
  questions: string[];
}

/** Reads the one endpoint the builder's model cards offer; `null` when it is not usable. */
export function modelTestEndpointFromConfig(appConfig: AppConfig): ModelTestEndpoint | null {
  const endpoint = (appConfig.endpoints?.[EModelEndpoint.custom] ?? []).find(
    (candidate) => candidate.name === MODEL_TEST_ENDPOINT,
  );
  const baseURL = extractEnvVariable(endpoint?.baseURL ?? '');
  const apiKey = extractEnvVariable(endpoint?.apiKey ?? '');
  const models = endpoint?.models?.default ?? [];
  if (!baseURL || !apiKey || baseURL.startsWith('${') || apiKey.startsWith('${')) {
    return null;
  }
  return {
    baseURL: baseURL.replace(/\/$/, ''),
    apiKey,
    models: models.flatMap((model) => (typeof model === 'string' ? [model] : [model.name])),
  };
}

/** Returns the parsed input, or the reason it was rejected. */
export function parseModelTestBody(raw: unknown, allowedModels: string[]): ModelTestInput | string {
  const body =
    raw != null && typeof raw === 'object' ? (raw as Partial<AdminModelTestRequest>) : undefined;
  const models: unknown[] | undefined = Array.isArray(body?.models) ? body.models : undefined;
  if (models == null || models.length !== 2 || models[0] === models[1]) {
    return 'Pick two different models';
  }
  const [first, second] = models;
  if (
    typeof first !== 'string' ||
    typeof second !== 'string' ||
    !allowedModels.includes(first) ||
    !allowedModels.includes(second)
  ) {
    return 'Unknown model';
  }
  const rawQuestions: unknown[] = Array.isArray(body?.questions) ? body.questions : [];
  const questions = rawQuestions.length
    ? rawQuestions
        .filter((question): question is string => typeof question === 'string')
        .map((question) => question.trim())
        .filter(Boolean)
    : [];
  if (questions.length === 0 || questions.length > MODEL_TEST_MAX_QUESTIONS) {
    return `Add between 1 and ${MODEL_TEST_MAX_QUESTIONS} questions`;
  }
  if (questions.some((question) => question.length > QUESTION_MAX)) {
    return `Keep each question under ${QUESTION_MAX} characters`;
  }
  const instructions = typeof body?.instructions === 'string' ? body.instructions : '';
  const agentId = typeof body?.agent_id === 'string' && body.agent_id ? body.agent_id : undefined;
  return {
    agentId,
    instructions: instructions.slice(0, INSTRUCTIONS_MAX),
    models: [first, second],
    questions,
  };
}

interface RagHit {
  content: string;
  filename: string;
  distance: number;
}

type RagQueryResponse = [{ page_content: string; metadata: { source?: string } }, number][];

/**
 * The same `/query` the `file_search` tool makes, scoped to the agent's entity id,
 * so a test sees the passages a student's question would retrieve.
 */
export async function searchAgentDocuments(params: {
  userId: string;
  agentId: string;
  fileIds: string[];
  query: string;
}): Promise<string> {
  const ragUrl = process.env.RAG_API_URL;
  if (!ragUrl || params.fileIds.length === 0) {
    return '';
  }
  const token = generateShortLivedToken(params.userId);
  const responses = await Promise.all(
    params.fileIds.map((fileId) =>
      fetch(`${ragUrl}/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_id: fileId,
          query: params.query,
          k: 5,
          entity_id: params.agentId,
        }),
      })
        .then((response) => (response.ok ? (response.json() as Promise<RagQueryResponse>) : []))
        .catch((error) => {
          logger.warn('[modelTest] document search failed', error);
          return [] as RagQueryResponse;
        }),
    ),
  );
  const hits: RagHit[] = responses.flatMap((rows) =>
    rows.map(([doc, distance]) => ({
      content: doc.page_content,
      filename: doc.metadata.source?.split('/').pop() ?? '',
      distance,
    })),
  );
  return hits
    .sort((a, b) => a.distance - b.distance)
    .slice(0, PASSAGES_PER_QUESTION)
    .map((hit) => `File: ${hit.filename}\nContent: ${hit.content}`)
    .join('\n---\n');
}

/** One chat-completions call; errors come back as the answer's `error`, never thrown. */
export async function callTestModel(params: {
  endpoint: ModelTestEndpoint;
  model: string;
  system: string;
  question: string;
}): Promise<AdminModelTestAnswer> {
  const started = Date.now();
  try {
    const response = await fetch(`${params.endpoint.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.endpoint.apiKey}`,
      },
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      body: JSON.stringify({
        model: params.model,
        max_completion_tokens: ANSWER_MAX_TOKENS,
        messages: [
          ...(params.system ? [{ role: 'system', content: params.system }] : []),
          { role: 'user', content: params.question },
        ],
      }),
    });
    const ms = Date.now() - started;
    if (!response.ok) {
      logger.warn(`[modelTest] ${params.model} returned ${response.status}`);
      return { model: params.model, text: '', ms, error: `The model returned ${response.status}` };
    }
    const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    return { model: params.model, text: data.choices?.[0]?.message?.content ?? '', ms };
  } catch (error) {
    logger.warn(`[modelTest] ${params.model} call failed`, error);
    return {
      model: params.model,
      text: '',
      ms: Date.now() - started,
      error: 'The model could not be reached or timed out',
    };
  }
}

/** The agent's prompt as a real run builds it: instructions, then the document context. */
export function buildTestSystemPrompt(instructions: string, ...contexts: string[]): string {
  const parts = [instructions.trim(), ...contexts.map((context) => context.trim())];
  return parts.filter(Boolean).join('\n\n');
}

export function formatPassages(passages: string): string {
  return passages ? `Relevant passages from the attached documents:\n${passages}` : '';
}

export async function runModelTest(params: {
  input: ModelTestInput;
  inlineContext: string;
  passagesFor: (question: string) => Promise<string>;
  ask: (model: string, system: string, question: string) => Promise<AdminModelTestAnswer>;
}): Promise<AdminModelTestResult[]> {
  const { input, inlineContext, passagesFor, ask } = params;
  return Promise.all(
    input.questions.map(async (question) => {
      const system = buildTestSystemPrompt(
        input.instructions,
        inlineContext,
        formatPassages(await passagesFor(question)),
      );
      const answers = await Promise.all(input.models.map((model) => ask(model, system, question)));
      return { question, answers };
    }),
  );
}
