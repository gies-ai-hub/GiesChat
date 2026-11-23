import { useRef, useEffect } from 'react';
import { useAtom } from 'jotai';
import type { TShowToast } from '~/common';
import { toastState, type ToastState } from '~/store';
import { NotificationSeverity } from '~/common';

/** Shortest time a toast stays up; long enough to read, and Radix pauses it while hovered or focused. */
export const TOAST_DURATION = 8000;

/** Errors stay until closed; anything else stays at least `TOAST_DURATION`. */
export const toastDuration = (
  severity: NotificationSeverity,
  requested: number = TOAST_DURATION,
): number =>
  severity === NotificationSeverity.ERROR ? Infinity : Math.max(requested, TOAST_DURATION);

export default function useToast(showDelay = 100): {
  toast: ToastState;
  onOpenChange: (open: boolean, id: number) => void;
  showToast: ({ message, severity, showIcon, duration, status }: TShowToast) => void;
} {
  const [toast, setToast] = useAtom(toastState);
  const showTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (showTimerRef.current !== null) {
        clearTimeout(showTimerRef.current);
      }
    };
  }, []);

  const showToast = ({
    message,
    severity = NotificationSeverity.SUCCESS,
    showIcon = true,
    duration,
    status,
  }: TShowToast): void => {
    if (showTimerRef.current !== null) {
      clearTimeout(showTimerRef.current);
    }
    const level = (status as NotificationSeverity) ?? severity;
    showTimerRef.current = window.setTimeout(() => {
      setToast((prev) => ({
        id: prev.id + 1,
        open: true,
        message,
        severity: level,
        showIcon,
        duration: toastDuration(level, duration),
      }));
    }, showDelay);
  };

  return {
    toast,
    /** Radix 1.1.5 never clears a replaced toast's timer, so a close from an older toast is ignored. */
    onOpenChange: (open: boolean, id: number): void =>
      setToast((prev) => (prev.id === id ? { ...prev, open } : prev)),
    showToast,
  };
}
