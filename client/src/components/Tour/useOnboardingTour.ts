import { useCallback, useEffect, useRef } from 'react';
import { useRecoilValue } from 'recoil';
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import type { Driver, DriveStep, PopoverDOM } from 'driver.js';
import { TOUR_REPLAY_KEY, TOUR_REPLAY_EVENT, resolveTourSteps } from './steps';
import store from '~/store';
import { useCompleteTourMutation } from '~/data-provider';
import { useAuthContext } from '~/hooks/AuthContext';
import { useLocalize } from '~/hooks';

let startedThisSession = false;

/** Delay before advancing after a click-to-advance step, so the click's own
 *  effect (panel expand, navigation) settles before the next spotlight positions */
const ADVANCE_DELAY_MS = 350;

export const addSecondaryButton = (popover: PopoverDOM, label: string, onClick: () => void) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.className = 'gc-tour-secondary';
  button.onclick = onClick;
  popover.previousButton.insertAdjacentElement('afterend', button);
};

export default function useOnboardingTour() {
  const localize = useLocalize();
  const { user } = useAuthContext();
  const embed = useRecoilValue(store.embed);
  const driverRef = useRef<Driver | null>(null);
  const completeTour = useCompleteTourMutation();
  const completeRef = useRef(completeTour.mutate);
  completeRef.current = completeTour.mutate;

  const startTour = useCallback(() => {
    startedThisSession = true;
    sessionStorage.removeItem(TOUR_REPLAY_KEY);
    driverRef.current?.destroy();

    let removeClickListener: (() => void) | null = null;
    const clearClickListener = () => {
      removeClickListener?.();
      removeClickListener = null;
    };

    const resolved = resolveTourSteps();
    const steps: DriveStep[] = resolved.map((step, index) => {
      const isLast = index === resolved.length - 1;
      const interactive = step.advanceOnClick === true && step.selector !== undefined;
      return {
        element: step.selector,
        popover: {
          title: localize(step.titleKey),
          description: interactive
            ? `${localize(step.descKey)}<div class="gc-tour-hint">${localize(step.hintKey ?? 'com_ui_tour_click_hint')}</div>`
            : localize(step.descKey),
          ...(step.selector !== undefined && { side: 'top' as const }),
          nextBtnText: localize(step.nextKey),
          doneBtnText: localize(step.nextKey),
          ...(interactive && { showButtons: ['previous', 'close'] as const }),
          onPopoverRender: (popover: PopoverDOM) =>
            addSecondaryButton(popover, localize('com_ui_tour_skip'), () =>
              driverRef.current?.destroy(),
            ),
          ...(isLast &&
            !interactive && {
              onNextClick: () => driverRef.current?.destroy(),
              onDoneClick: () => driverRef.current?.destroy(),
            }),
        },
        ...(interactive && {
          onHighlighted: (element?: Element) => {
            clearClickListener();
            if (element == null) {
              return;
            }
            const handler = (event: Event) => {
              const target = event.target instanceof Element ? event.target : null;
              if (
                step.clickTargetSelector !== undefined &&
                target?.closest(step.clickTargetSelector) == null
              ) {
                return;
              }
              clearClickListener();
              window.setTimeout(() => {
                if (isLast) {
                  driverRef.current?.destroy();
                } else {
                  driverRef.current?.moveNext();
                }
              }, ADVANCE_DELAY_MS);
            };
            element.addEventListener('click', handler, { capture: true });
            removeClickListener = () =>
              element.removeEventListener('click', handler, { capture: true });
          },
          onDeselected: () => clearClickListener(),
        }),
      };
    });

    driverRef.current = driver({
      steps,
      showProgress: true,
      overlayOpacity: 0.55,
      stagePadding: 6,
      disableActiveInteraction: false,
      popoverClass: 'gieschat-tour',
      progressText: '{{current}} of {{total}}',
      nextBtnText: localize('com_ui_tour_next'),
      prevBtnText: localize('com_ui_tour_back'),
      doneBtnText: localize('com_ui_tour_done'),
      onDestroyed: () => {
        clearClickListener();
        completeRef.current();
      },
    });
    driverRef.current.drive();
  }, [localize]);

  useEffect(() => {
    if (user == null || embed != null) {
      return;
    }
    const replay = sessionStorage.getItem(TOUR_REPLAY_KEY) === '1';
    if (!replay && (startedThisSession || user.onboardingCompletedAt != null)) {
      return;
    }
    const timeout = setTimeout(() => {
      if (startedThisSession && !replay) {
        return;
      }
      startTour();
    }, 600);
    return () => clearTimeout(timeout);
  }, [user, embed, startTour]);

  useEffect(() => {
    const handler = () => startTour();
    window.addEventListener(TOUR_REPLAY_EVENT, handler);
    return () => {
      window.removeEventListener(TOUR_REPLAY_EVENT, handler);
      driverRef.current?.destroy();
    };
  }, [startTour]);
}
