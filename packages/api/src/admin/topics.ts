import { z } from 'zod';
import { EModelEndpoint, extractEnvVariable } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';

export const TOPIC_SAMPLE_LIMIT = 200;
export const TOPIC_TEXT_LIMIT = 300;
const TOPIC_MAX = 6;
const TOPIC_LABEL_MAX = 60;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface TopicsModel {
  baseURL: string;
  apiKey: string;
  model: string;
}

export interface Topic {
  label: string;
  count: number;
}

export interface TopicsResult {
  topics: Topic[];
  sampleSize: number;
}

const topicsSchema = z.object({
  topics: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(TOPIC_LABEL_MAX),
        count: z.number().int().nonnegative(),
      }),
    )
    .max(TOPIC_MAX),
});

const SYSTEM_PROMPT = `You summarize what students ask a course assistant. Group the student messages into at most ${TOPIC_MAX} topics a professor would recognize; use fewer when the messages do not support more. Fold the leftovers into a topic named "Other". Return only JSON of the form {"topics":[{"label":string,"count":integer}]}, counts summing to the number of messages, labels at most ${TOPIC_LABEL_MAX} characters. Never quote a message or name a person.`;

/** The cheap Azure model the app already uses to name conversations. */
export function topicsModelFromConfig(appConfig: AppConfig): TopicsModel | null {
  const endpoint = (appConfig.endpoints?.[EModelEndpoint.custom] ?? []).find(
    (candidate) => candidate.titleModel && candidate.baseURL && candidate.apiKey,
  );
  if (!endpoint) {
    return null;
  }
  const baseURL = extractEnvVariable(endpoint.baseURL ?? '');
  const apiKey = extractEnvVariable(endpoint.apiKey ?? '');
  if (!baseURL || !apiKey) {
    return null;
  }
  return { baseURL: baseURL.replace(/\/$/, ''), apiKey, model: endpoint.titleModel ?? '' };
}

async function askModel(texts: string[], llm: TopicsModel): Promise<Topic[]> {
  const numbered = texts
    .map((text, index) => `${index + 1}. ${text.slice(0, TOPIC_TEXT_LIMIT).replace(/\s+/g, ' ')}`)
    .join('\n');
  const response = await fetch(`${llm.baseURL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llm.apiKey}` },
    body: JSON.stringify({
      model: llm.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `${texts.length} student messages:\n${numbered}` },
      ],
      response_format: { type: 'json_object' },
    }),
  });
  if (!response.ok) {
    throw new Error(`topics model responded ${response.status}`);
  }
  const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const content = body.choices?.[0]?.message?.content ?? '';
  const parsed = topicsSchema.parse(JSON.parse(content));
  return parsed.topics.sort((a, b) => b.count - a.count);
}

// ponytail: in-process cache, one instance in prod; move to the keyv store if the app scales out.
const cache = new Map<string, { expires: number; result: TopicsResult }>();

/** One model call per scope per day; the model never sees who wrote what. */
export async function summarizeTopics(
  key: string,
  texts: string[],
  llm: TopicsModel,
): Promise<TopicsResult> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) {
    return hit.result;
  }
  const result: TopicsResult =
    texts.length === 0
      ? { topics: [], sampleSize: 0 }
      : { topics: await askModel(texts, llm), sampleSize: texts.length };
  cache.set(key, { expires: Date.now() + CACHE_TTL_MS, result });
  return result;
}

export function clearTopicsCache(): void {
  cache.clear();
}
