import { resolveSourceMatch } from './source';

const findGuestIds = jest.fn().mockResolvedValue(['g1', 'g2']);
const KEY_ID = '64b7f0c2a1b2c3d4e5f60718';

describe('resolveSourceMatch', () => {
  it.each([
    [undefined, undefined],
    ['all', undefined],
    ['api', { apiKeyId: { $exists: true } }],
    ['embed', { user: { $in: ['g1', 'g2'] } }],
    ['gieschat', { apiKeyId: { $exists: false }, user: { $nin: ['g1', 'g2'] } }],
    [KEY_ID, { apiKeyId: KEY_ID }],
  ])('maps %p', async (raw, expected) => {
    expect(await resolveSourceMatch(raw, ['agent_a'], findGuestIds)).toEqual(expected);
  });

  it.each([['nope'], [['api']], [{ $ne: 1 }]])('refuses %p', async (raw) => {
    expect(await resolveSourceMatch(raw, ['agent_a'], findGuestIds)).toBeNull();
  });

  it('looks up guests only for the agents in scope', async () => {
    await resolveSourceMatch('embed', ['agent_a', 'agent_b'], findGuestIds);
    expect(findGuestIds).toHaveBeenLastCalledWith(['agent_a', 'agent_b']);
  });
});
