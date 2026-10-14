import type { TranslationKeys } from '~/hooks/useLocalize';

export const TOUR_REPLAY_KEY = 'gieschat:tour-replay';
export const TOUR_REPLAY_EVENT = 'gieschat:tour-replay';

export interface TourStepDef {
  id:
    | 'welcome'
    | 'new-chat'
    | 'chats'
    | 'rooms'
    | 'composer'
    | 'model-picker'
    | 'model-menu'
    | 'report-issue'
    | 'course-tutors';
  selector?: string;
  fallbackSelector?: string;
  titleKey: TranslationKeys;
  descKey: TranslationKeys;
  nextKey: TranslationKeys;
  hintKey?: TranslationKeys;
  centered?: boolean;
  centeredWhenMissing?: boolean;
  advanceOnClick?: boolean;
  /** Keep the step when this selector is visible, resolving `selector` at highlight
   *  time instead — for targets that only appear mid-tour (e.g. an opened menu) */
  visibleWhen?: string;
  /** Advance only when the click lands inside a matching element */
  clickTargetSelector?: string;
}

export const TOUR_STEPS: TourStepDef[] = [
  {
    id: 'welcome',
    titleKey: 'com_ui_tour_welcome_title',
    descKey: 'com_ui_tour_welcome_desc',
    nextKey: 'com_ui_tour_difference',
    centered: true,
  },
  {
    id: 'new-chat',
    selector: '[data-testid="new-chat-button"]',
    titleKey: 'com_ui_tour_new_chat_title',
    descKey: 'com_ui_tour_new_chat_desc',
    nextKey: 'com_ui_tour_next',
    advanceOnClick: true,
  },
  {
    id: 'chats',
    selector: '[data-testid="nav-panel-conversations"]',
    titleKey: 'com_ui_tour_chats_title',
    descKey: 'com_ui_tour_chats_desc',
    nextKey: 'com_ui_tour_next',
    advanceOnClick: true,
  },
  {
    id: 'rooms',
    selector: '[data-testid="nav-panel-brainstorm"]',
    titleKey: 'com_ui_tour_rooms_title',
    descKey: 'com_ui_tour_rooms_desc',
    nextKey: 'com_ui_tour_next',
    advanceOnClick: true,
  },
  {
    id: 'composer',
    selector: '[data-tour="chat-composer"]',
    titleKey: 'com_ui_tour_composer_title',
    descKey: 'com_ui_tour_composer_desc',
    nextKey: 'com_ui_tour_next',
    centeredWhenMissing: true,
  },
  {
    id: 'report-issue',
    selector: '[data-tour="report-issue"]',
    titleKey: 'com_ui_tour_report_title',
    descKey: 'com_ui_tour_report_desc',
    nextKey: 'com_ui_tour_next',
  },
  {
    id: 'course-tutors',
    selector: '[data-testid="nav-agents-button"]',
    fallbackSelector: '[data-testid="nav-more-button"]',
    titleKey: 'com_ui_tour_tutors_title',
    descKey: 'com_ui_tour_tutors_desc',
    nextKey: 'com_ui_tour_done',
    advanceOnClick: true,
  },
];

const isVisible = (selector: string) =>
  (document.querySelector(selector)?.getClientRects().length ?? 0) > 0;

function resolveSelector(step: TourStepDef): string | undefined {
  if (step.selector !== undefined && isVisible(step.selector)) {
    return step.selector;
  }
  if (step.fallbackSelector !== undefined && isVisible(step.fallbackSelector)) {
    return step.fallbackSelector;
  }
  return undefined;
}

export function resolveTourSteps(steps: TourStepDef[] = TOUR_STEPS): TourStepDef[] {
  return steps.flatMap((step) => {
    if (step.selector === undefined) {
      return [step];
    }

    if (step.visibleWhen !== undefined) {
      return isVisible(step.visibleWhen) ? [step] : [];
    }

    const selector = resolveSelector(step);

    if (selector === undefined && !step.centeredWhenMissing) {
      return [];
    }

    return [{ ...step, selector }];
  });
}
