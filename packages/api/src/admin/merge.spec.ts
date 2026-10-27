import type { DraftDocument, DraftUpdateInput } from './merge';
import { planDraftUpdate } from './merge';
import { DRAFT_FIELDS_TO_COPY } from './usage';

const BASE_INSTRUCTIONS = [
  'You are the office-hours assistant for FIN 221.',
  'Never hand over final answers to graded work.',
  'Office hours: Tuesdays 2-4 pm, Wohlers 260.',
  'Keep answers under 200 words.',
].join('\n');

const doc = (key: string, name: string): DraftDocument => ({ key, name });

function plan(input: Partial<DraftUpdateInput>) {
  return planDraftUpdate({
    fields: DRAFT_FIELDS_TO_COPY,
    base: {},
    mine: {},
    theirs: {},
    documents: new Map(),
    ...input,
  });
}

describe('planDraftUpdate', () => {
  const base = {
    name: 'Finance Office Hours',
    model: 'gpt-6-luna',
    instructions: BASE_INSTRUCTIONS,
  };

  it('reports nothing when neither side changed, and treats empty values as equal', () => {
    const result = plan({
      base,
      mine: { ...base, conversation_starters: [] },
      theirs: { ...base, conversation_starters: undefined },
    });
    expect(result.changes).toEqual([]);
    expect(result.conflicts).toEqual([]);
    expect(result.resolve({})).toEqual({});
  });

  it('brings in what only production changed and keeps what only the draft changed', () => {
    const result = plan({
      base,
      mine: { ...base, name: 'FIN 221 Helper' },
      theirs: { ...base, model: 'gpt-6.1-sol' },
    });
    expect(result.changes).toEqual([
      { field: 'name', from: 'draft', before: 'Finance Office Hours', after: 'FIN 221 Helper' },
      { field: 'model', from: 'production', before: 'gpt-6-luna', after: 'gpt-6.1-sol' },
    ]);
    expect(result.conflicts).toEqual([]);
    expect(result.resolve({})).toEqual({ model: 'gpt-6.1-sol' });
  });

  it('merges instruction edits to different lines without a conflict', () => {
    const mine = BASE_INSTRUCTIONS.replace(
      'Never hand over',
      'When a student is stuck on NPV, walk the timeline first.\nNever hand over',
    );
    const theirs = `${BASE_INSTRUCTIONS}\nExam 2 covers chapters 7-10.`;
    const result = plan({
      base,
      mine: { ...base, instructions: mine },
      theirs: { ...base, instructions: theirs },
    });
    expect(result.conflicts).toEqual([]);
    expect(result.changes).toEqual([
      {
        field: 'instructions',
        from: 'production',
        before: null,
        after: 'Exam 2 covers chapters 7-10.',
      },
      {
        field: 'instructions',
        from: 'draft',
        before: null,
        after: 'When a student is stuck on NPV, walk the timeline first.',
      },
    ]);
    const merged = result.resolve({})?.instructions ?? '';
    expect(merged).toContain('walk the timeline first');
    expect(merged).toContain('Exam 2 covers chapters 7-10.');
    expect(merged.split('\n')).toHaveLength(6);
  });

  it('turns overlapping instruction edits into a conflict that each pick resolves', () => {
    const mine = BASE_INSTRUCTIONS.replace(
      'Tuesdays 2-4 pm, Wohlers 260.',
      'Tuesdays 2-4 pm, Wohlers 260, and Thursdays on Zoom.',
    );
    const theirs = BASE_INSTRUCTIONS.replace(
      'Tuesdays 2-4 pm, Wohlers 260.',
      'Tuesdays 3-5 pm, BIF 2030.',
    );
    const result = plan({
      base,
      mine: { ...base, instructions: mine },
      theirs: { ...base, instructions: theirs },
    });
    expect(result.conflicts).toEqual([
      {
        id: 'instructions:0',
        field: 'instructions',
        context: 'Never hand over final answers to graded work.',
        mine: 'Office hours: Tuesdays 2-4 pm, Wohlers 260, and Thursdays on Zoom.',
        theirs: 'Office hours: Tuesdays 3-5 pm, BIF 2030.',
      },
    ]);
    expect(result.resolve({})).toBeNull();
    expect(result.resolve({ 'instructions:0': 'theirs' })?.instructions).toBe(theirs);
    expect(result.resolve({ 'instructions:0': 'mine' })?.instructions).toBe(mine);
  });

  it('makes a field both sides changed differently a whole-field conflict', () => {
    const result = plan({
      base,
      mine: { ...base, model: 'claude-sonnet-5-5' },
      theirs: { ...base, model: 'gpt-6.1-sol' },
    });
    expect(result.conflicts).toEqual([
      {
        id: 'model',
        field: 'model',
        context: null,
        mine: 'claude-sonnet-5-5',
        theirs: 'gpt-6.1-sol',
      },
    ]);
    expect(result.resolve({ model: 'theirs' })).toEqual({ model: 'gpt-6.1-sol' });
    expect(result.resolve({ model: 'mine' })).toEqual({});
  });

  it('keeps the same change made on both sides as the draft’s, with no conflict', () => {
    const result = plan({
      base,
      mine: { ...base, model: 'gpt-6.1-sol' },
      theirs: { ...base, model: 'gpt-6.1-sol' },
    });
    expect(result.conflicts).toEqual([]);
    expect(result.resolve({})).toEqual({});
  });

  /**
   * Both sides are measured against production's snapshot, not the draft's own last
   * state, so an edit the owner kept in an earlier update still counts as theirs.
   */
  it('still protects an edit kept in an earlier update when production changes it later', () => {
    const synced = { ...base, conversation_starters: ['What is NPV?'] };
    const result = plan({
      base: synced,
      mine: { ...synced, conversation_starters: ['What is NPV?', 'Explain WACC'] },
      theirs: { ...synced, conversation_starters: ['What is NPV?', 'When is Exam 2?'] },
    });
    expect(result.conflicts.map((conflict) => conflict.id)).toEqual(['conversation_starters']);
  });

  it('merges documents as a set, matching the draft’s own copies to production’s files', () => {
    const documents = new Map([
      ['syllabus_prod', doc('/files/syllabus.pdf', 'syllabus.pdf')],
      ['syllabus_copy', doc('/files/syllabus.pdf', 'syllabus.pdf')],
      ['week8_prod', doc('/files/week8.pdf', 'Week 8.pdf')],
      ['week8_copy', doc('/files/week8.pdf', 'Week 8.pdf')],
      ['week9_prod', doc('/files/week9.pdf', 'Week 9 - Capital budgeting.pdf')],
      ['notes_draft', doc('/files/notes.txt', 'TA notes.txt')],
    ]);
    const result = plan({
      documents,
      base: { tool_resources: { context: { file_ids: ['syllabus_prod', 'week8_prod'] } } },
      mine: {
        tool_resources: { context: { file_ids: ['syllabus_copy', 'week8_copy', 'notes_draft'] } },
      },
      theirs: { tool_resources: { context: { file_ids: ['syllabus_prod', 'week9_prod'] } } },
    });
    expect(result.conflicts).toEqual([]);
    expect(result.incomingDocuments).toEqual(['week9_prod']);
    expect(result.changes).toEqual([
      { field: 'tool_resources', from: 'draft', before: null, after: '+ TA notes.txt' },
      {
        field: 'tool_resources',
        from: 'production',
        before: null,
        after: '+ Week 9 - Capital budgeting.pdf\n− Week 8.pdf',
      },
    ]);
    expect(result.resolve({})?.tool_resources).toEqual({
      context: { file_ids: ['syllabus_copy', 'notes_draft', 'week9_prod'] },
    });
  });
});
