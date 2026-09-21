import type { Agent, TModelSpec } from 'librechat-data-provider';
import { modelLockLabel } from '../useAgentModelLock';

const specs = [
  {
    name: 'gieschat-luna',
    label: 'GPT-5.6 Luna',
    description: 'The everyday model.',
    preset: { endpoint: 'Azure OpenAI', model: 'gpt-5.6-luna' },
  },
] as unknown as TModelSpec[];

const agent = (overrides: Partial<Agent>) =>
  ({ provider: 'Azure OpenAI', model: 'gpt-5.6-luna', ...overrides }) as Agent;

describe('modelLockLabel', () => {
  it('names the model of an agent built in the class dashboard', () => {
    expect(modelLockLabel(agent({ createdVia: 'dashboard' }), specs)).toBe('GPT-5.6 Luna');
  });

  it('falls back to the model guide for a model with no chat spec', () => {
    expect(modelLockLabel(agent({ createdVia: 'dashboard', model: 'gpt-5.6-terra' }), specs)).toBe(
      'GPT-5.6 Terra',
    );
  });

  it('falls back to the raw id when nothing names the model', () => {
    expect(modelLockLabel(agent({ createdVia: 'dashboard', model: 'gpt-9-unknown' }), specs)).toBe(
      'gpt-9-unknown',
    );
  });

  it('leaves the picker alone for agents built anywhere else', () => {
    expect(modelLockLabel(agent({ createdVia: 'marketplace' }), specs)).toBeNull();
    expect(modelLockLabel(agent({}), specs)).toBeNull();
    expect(modelLockLabel(undefined, specs)).toBeNull();
  });

  it('leaves the picker alone when the agent carries no model', () => {
    expect(modelLockLabel(agent({ createdVia: 'dashboard', model: null }), specs)).toBeNull();
  });
});
