/**
 * Still in `librechat.yaml`'s model list so agents pinned to them keep validating,
 * but never offered in a picker and refused by the agent API. Remove an id here once
 * nothing uses it.
 */
export const RETIRED_MODELS: ReadonlySet<string> = new Set([
  'claude-sonnet-5',
  'claude-opus-4-8',
  'gpt-6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5',
  'gpt-5.4',
  'gpt-5.4-mini',
]);
