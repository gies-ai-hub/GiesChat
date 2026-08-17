import { Constants } from 'librechat-data-provider';
import { shouldKeepDraftSpec } from '../endpoints';

const DRAFT = Constants.NEW_CONVO as string;
const DEFAULT_SPEC = 'gieschat-general-mini';
const WORK_SPEC = 'gieschat-deck-builder';

describe('shouldKeepDraftSpec', () => {
  it('keeps a spec the user picked when the app re-derives the admin default', () => {
    expect(
      shouldKeepDraftSpec({
        isDerivedDefault: true,
        nextConversationId: DRAFT,
        prevConversationId: DRAFT,
        prevSpec: WORK_SPEC,
        nextSpec: DEFAULT_SPEC,
      }),
    ).toBe(true);
  });

  it('yields to an explicit user selection, even back to the default spec', () => {
    expect(
      shouldKeepDraftSpec({
        isDerivedDefault: false,
        nextConversationId: DRAFT,
        prevConversationId: DRAFT,
        prevSpec: WORK_SPEC,
        nextSpec: DEFAULT_SPEC,
      }),
    ).toBe(false);
  });

  it('applies the default on a first load, when the draft names no spec yet', () => {
    expect(
      shouldKeepDraftSpec({
        isDerivedDefault: true,
        nextConversationId: DRAFT,
        prevConversationId: DRAFT,
        prevSpec: null,
        nextSpec: DEFAULT_SPEC,
      }),
    ).toBe(false);
  });

  it('leaves existing conversations alone', () => {
    expect(
      shouldKeepDraftSpec({
        isDerivedDefault: true,
        nextConversationId: DRAFT,
        prevConversationId: '4d3f60ec-66da-46a4-baa4-6eb492192e4f',
        prevSpec: WORK_SPEC,
        nextSpec: DEFAULT_SPEC,
      }),
    ).toBe(false);
  });

  it('does not fire when the draft already holds the incoming spec', () => {
    expect(
      shouldKeepDraftSpec({
        isDerivedDefault: true,
        nextConversationId: DRAFT,
        prevConversationId: DRAFT,
        prevSpec: DEFAULT_SPEC,
        nextSpec: DEFAULT_SPEC,
      }),
    ).toBe(false);
  });
});
