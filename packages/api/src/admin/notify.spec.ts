import { Types } from 'mongoose';
import type { IAgent, IUser } from '@librechat/data-schemas';
import type { DraftNotifyDeps } from './notify';
import { notifyOutdatedDrafts } from './notify';

const profId = new Types.ObjectId();
const taId = new Types.ObjectId();
const coAdminId = new Types.ObjectId();

const users = [
  { _id: profId, name: 'Maria Chen', email: 'mchen@illinois.edu' },
  { _id: taId, name: 'Jordan Patel', email: 'jpatel7@illinois.edu' },
  { _id: coAdminId, name: 'Sam Rivera', email: 'srivera@illinois.edu' },
] as IUser[];

const production = (versions: { updatedBy?: Types.ObjectId }[]) =>
  ({ id: 'agent_prod', name: 'Finance Office Hours', author: profId, versions }) as IAgent;

const draft = (fields: Partial<IAgent>) =>
  ({ id: 'agent_draft', author: taId, draftOf: 'agent_prod', draftBase: 5, ...fields }) as IAgent;

type Args<K extends keyof DraftNotifyDeps> = Parameters<DraftNotifyDeps[K]>;

function deps(agents: { drafts: IAgent[]; productions: IAgent[] }) {
  return {
    findAgents: jest.fn<Promise<IAgent[]>, Args<'findAgents'>>(async (filter) =>
      'draftOf' in filter ? agents.drafts : agents.productions,
    ),
    findUsers: jest.fn<Promise<IUser[]>, Args<'findUsers'>>(async () => users),
    setAgentMeta: jest.fn<Promise<IAgent | null>, Args<'setAgentMeta'>>(async () => null),
    sendDraftOutdated: jest.fn<Promise<void>, Args<'sendDraftOutdated'>>(async () => undefined),
  };
}

const versions = (count: number, updatedBy?: Types.ObjectId) =>
  Array.from({ length: count }, () => ({ updatedBy }));

describe('notifyOutdatedDrafts', () => {
  it('emails the owner once, naming who changed production, and remembers it', async () => {
    const d = deps({ drafts: [draft({})], productions: [production(versions(7, profId))] });
    expect(await notifyOutdatedDrafts(d)).toBe(1);
    expect(d.sendDraftOutdated).toHaveBeenCalledWith({
      email: 'jpatel7@illinois.edu',
      agentName: 'Finance Office Hours',
      changedBy: 'Maria Chen',
      from: 5,
      to: 7,
    });
    expect(d.setAgentMeta).toHaveBeenCalledWith('agent_draft', { notifiedBase: 5 });
  });

  it('skips a draft already told about this base, and one that is up to date', async () => {
    const told = deps({
      drafts: [draft({ notifiedBase: 5 })],
      productions: [production(versions(7, profId))],
    });
    expect(await notifyOutdatedDrafts(told)).toBe(0);
    expect(told.findAgents).toHaveBeenCalledTimes(1);

    const current = deps({ drafts: [draft({})], productions: [production(versions(5, profId))] });
    expect(await notifyOutdatedDrafts(current)).toBe(0);
    expect(current.sendDraftOutdated).not.toHaveBeenCalled();
    expect(current.setAgentMeta).not.toHaveBeenCalled();
  });

  it('marks without emailing when the owner made the newest version themselves', async () => {
    const d = deps({ drafts: [draft({})], productions: [production(versions(6, taId))] });
    expect(await notifyOutdatedDrafts(d)).toBe(0);
    expect(d.sendDraftOutdated).not.toHaveBeenCalled();
    expect(d.setAgentMeta).toHaveBeenCalledWith('agent_draft', { notifiedBase: 5 });
  });

  it('leaves the draft unmarked when the email fails, so the next pass retries', async () => {
    const d = deps({ drafts: [draft({})], productions: [production(versions(6, coAdminId))] });
    d.sendDraftOutdated.mockRejectedValueOnce(new Error('ACS down'));
    expect(await notifyOutdatedDrafts(d)).toBe(0);
    expect(d.setAgentMeta).not.toHaveBeenCalled();
  });
});
