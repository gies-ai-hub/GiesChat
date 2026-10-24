import isEqual from 'lodash/isEqual';
import { diff3Merge } from 'node-diff3';
import type {
  AdminDraftChange,
  AdminDraftChoice,
  AdminDraftConflict,
  AgentToolResources,
} from 'librechat-data-provider';
import type { MergeRegion } from 'node-diff3';
import type { DraftFields } from './usage';

type DraftValues = Partial<DraftFields>;

/** A document as both sides see it: copies of one file share a key but not an id. */
export interface DraftDocument {
  key: string;
  name: string;
}

export interface DraftUpdateInput {
  fields: readonly (keyof DraftFields)[];
  /** Production at the version the draft is based on: the shared starting point. */
  base: DraftValues;
  /** The draft now. */
  mine: DraftValues;
  /** Production now. */
  theirs: DraftValues;
  /** Every file id the three sides reference; an unknown id is its own key. */
  documents: Map<string, DraftDocument>;
}

export interface DraftUpdatePlan {
  changes: AdminDraftChange[];
  conflicts: AdminDraftConflict[];
  /** Production's file ids the draft gains; search-indexed ones need the draft's own copies. */
  incomingDocuments: string[];
  /** The fields to write once every conflict has a pick, or `null` when one is missing. */
  resolve: (choices: Record<string, AdminDraftChoice>) => DraftValues | null;
}

const isEmpty = (value: unknown): boolean =>
  value == null ||
  value === '' ||
  (Array.isArray(value) && value.length === 0) ||
  (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);

const same = (a: unknown, b: unknown): boolean => (isEmpty(a) && isEmpty(b)) || isEqual(a, b);

const toLines = (text: string | undefined): string[] =>
  (text ?? '').replace(/\r\n/g, '\n').split('\n');

/** Lines of `after` that `before` lacks: what one side wrote, for the summary. */
const addedLines = (before: string | undefined, after: string | undefined): string => {
  const existing = new Set(toLines(before));
  return toLines(after)
    .filter((line) => line.trim() !== '' && !existing.has(line))
    .join('\n');
};

const display = (value: unknown): string => {
  if (value == null) {
    return '';
  }
  if (Array.isArray(value)) {
    return value.map(display).join(', ');
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
};

const resourceNames = (...sides: (AgentToolResources | undefined)[]): string[] => [
  ...new Set(sides.flatMap((side) => Object.keys(side ?? {}))),
];

const fileIdsOf = (side: AgentToolResources | undefined, name: string): string[] =>
  side?.[name as keyof AgentToolResources]?.file_ids ?? [];

/**
 * Documents merge as a set per resource and never clash: what either side added is kept,
 * what either side removed goes. The draft keeps its own copy of a document it already
 * has; one only production added comes over by production's id.
 */
function mergeDocuments(
  base: AgentToolResources | undefined,
  mine: AgentToolResources | undefined,
  theirs: AgentToolResources | undefined,
  documents: Map<string, DraftDocument>,
): { merged: AgentToolResources; incoming: string[]; added: string[]; removed: string[] } {
  const keyOf = (id: string) => documents.get(id)?.key ?? id;
  const nameOf = (id: string) => documents.get(id)?.name ?? id;
  const merged: AgentToolResources = { ...mine };
  const incoming: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  for (const name of resourceNames(base, mine, theirs)) {
    const resource = name as keyof AgentToolResources;
    const baseIds = fileIdsOf(base, name);
    const mineIds = fileIdsOf(mine, name);
    const theirIds = fileIdsOf(theirs, name);
    const baseKeys = new Set(baseIds.map(keyOf));
    const mineKeys = new Set(mineIds.map(keyOf));
    const theirKeys = new Set(theirIds.map(keyOf));
    const dropped = mineIds.filter((id) => baseKeys.has(keyOf(id)) && !theirKeys.has(keyOf(id)));
    const gained = theirIds.filter((id) => !baseKeys.has(keyOf(id)) && !mineKeys.has(keyOf(id)));
    if (dropped.length === 0 && gained.length === 0) {
      continue;
    }
    const droppedSet = new Set(dropped);
    merged[resource] = {
      ...mine?.[resource],
      file_ids: [...mineIds.filter((id) => !droppedSet.has(id)), ...gained],
    };
    incoming.push(...gained);
    added.push(...gained.map(nameOf));
    removed.push(...dropped.map(nameOf));
  }
  return { merged, incoming, added, removed };
}

/** One side's document edits relative to the base, as "+ name" / "− name" lines. */
function documentSummary(
  before: AgentToolResources | undefined,
  after: AgentToolResources | undefined,
  documents: Map<string, DraftDocument>,
): string {
  const entries = (side: AgentToolResources | undefined) =>
    new Map(
      resourceNames(side).flatMap((name) =>
        fileIdsOf(side, name).map((id): [string, string] => [
          documents.get(id)?.key ?? id,
          documents.get(id)?.name ?? id,
        ]),
      ),
    );
  const was = entries(before);
  const now = entries(after);
  return [
    ...[...now].filter(([key]) => !was.has(key)).map(([, name]) => `+ ${name}`),
    ...[...was].filter(([key]) => !now.has(key)).map(([, name]) => `− ${name}`),
  ].join('\n');
}

/** Each resource's documents by identity, so the draft's copies compare equal to production's files. */
const documentKeys = (side: AgentToolResources | undefined, docs: Map<string, DraftDocument>) =>
  Object.fromEntries(
    resourceNames(side)
      .map((name): [string, string[]] => [
        name,
        [...new Set(fileIdsOf(side, name).map((id) => docs.get(id)?.key ?? id))].sort(),
      ])
      .filter(([, keys]) => keys.length > 0),
  );

/**
 * A three-way merge of a draft onto newer production, field by field, against the
 * production version the draft started from. A field only production changed comes in, a
 * field only the draft changed stays, and a field both changed differently is a conflict;
 * instructions merge line by line, so only overlapping edits clash. Pure: the caller loads
 * the three sides and writes the result.
 */
export function planDraftUpdate(input: DraftUpdateInput): DraftUpdatePlan {
  const { fields, base, mine, theirs, documents } = input;
  const changes: AdminDraftChange[] = [];
  const conflicts: AdminDraftConflict[] = [];
  const settled: DraftValues = {};
  const wholeConflicts = new Map<string, unknown>();
  let instructionBlocks: MergeRegion<string>[] | null = null;
  let incomingDocuments: string[] = [];

  for (const field of fields) {
    if (field === 'tool_resources') {
      const docs = (side: DraftValues) => documentKeys(side.tool_resources, documents);
      const mineChanged = !same(docs(mine), docs(base));
      const theirsChanged = !same(docs(theirs), docs(base));
      if (mineChanged) {
        const after = documentSummary(base.tool_resources, mine.tool_resources, documents);
        changes.push({ field, from: 'draft', before: null, after });
      }
      if (!theirsChanged) {
        continue;
      }
      const result = mergeDocuments(
        base.tool_resources,
        mine.tool_resources,
        theirs.tool_resources,
        documents,
      );
      const after = [
        ...result.added.map((name) => `+ ${name}`),
        ...result.removed.map((name) => `− ${name}`),
      ].join('\n');
      if (after) {
        settled.tool_resources = result.merged;
        incomingDocuments = result.incoming;
        changes.push({ field, from: 'production', before: null, after });
      }
      continue;
    }

    const mineChanged = !same(mine[field], base[field]);
    const theirsChanged = !same(theirs[field], base[field]);
    const lines = field === 'instructions';
    const summary = (side: DraftValues) =>
      lines ? addedLines(base.instructions, side.instructions) : display(side[field]);
    const before = lines ? null : display(base[field]);

    if (mineChanged && (!theirsChanged || same(mine[field], theirs[field]))) {
      changes.push({ field, from: 'draft', before, after: summary(mine) });
      continue;
    }
    if (!theirsChanged) {
      continue;
    }
    if (!mineChanged) {
      (settled as Record<string, unknown>)[field] = theirs[field];
      changes.push({ field, from: 'production', before, after: summary(theirs) });
      continue;
    }
    if (!lines) {
      wholeConflicts.set(field, theirs[field]);
      conflicts.push({
        id: field,
        field,
        context: null,
        mine: display(mine[field]),
        theirs: display(theirs[field]),
      });
      continue;
    }

    const blocks = diff3Merge(
      toLines(mine.instructions),
      toLines(base.instructions),
      toLines(theirs.instructions),
      { excludeFalseConflicts: true },
    );
    let previous = '';
    let hunk = 0;
    for (const block of blocks) {
      if (block.conflict == null) {
        previous = block.ok?.[block.ok.length - 1] ?? previous;
        continue;
      }
      conflicts.push({
        id: `instructions:${hunk}`,
        field,
        context: previous || null,
        mine: block.conflict.a.join('\n'),
        theirs: block.conflict.b.join('\n'),
      });
      hunk += 1;
    }
    if (hunk === 0) {
      settled.instructions = blocks.flatMap((block) => block.ok ?? []).join('\n');
      changes.push(
        { field, from: 'production', before: null, after: summary(theirs) },
        { field, from: 'draft', before: null, after: summary(mine) },
      );
      continue;
    }
    instructionBlocks = blocks;
  }

  const resolve = (choices: Record<string, AdminDraftChoice>): DraftValues | null => {
    if (conflicts.some((conflict) => choices[conflict.id] == null)) {
      return null;
    }
    const resolved: DraftValues = { ...settled };
    for (const [field, value] of wholeConflicts) {
      if (choices[field] === 'theirs') {
        (resolved as Record<string, unknown>)[field] = value;
      }
    }
    if (instructionBlocks != null) {
      let hunk = 0;
      resolved.instructions = instructionBlocks
        .flatMap((block) => {
          if (block.conflict == null) {
            return block.ok ?? [];
          }
          const theirsPicked = choices[`instructions:${hunk}`] === 'theirs';
          hunk += 1;
          return theirsPicked ? block.conflict.b : block.conflict.a;
        })
        .join('\n');
    }
    return resolved;
  };

  return { changes, conflicts, incomingDocuments, resolve };
}
