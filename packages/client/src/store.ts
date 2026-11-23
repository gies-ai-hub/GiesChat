import { atom, PrimitiveAtom } from 'jotai';
import { NotificationSeverity } from '~/common';

export const chatDirectionAtom: PrimitiveAtom<string> & {
  init: string;
} = atom<string>('ltr');
export const fontSizeAtom: PrimitiveAtom<string> & {
  init: string;
} = atom<string>('text-base');

export type ToastState = {
  /** Changes with every toast so each one remounts: Radix restarts its timer and announces it. */
  id: number;
  open: boolean;
  message: string;
  severity: NotificationSeverity;
  showIcon: boolean;
  /** Milliseconds, handed to Radix, which pauses it on hover and focus; `Infinity` waits for Close. */
  duration: number;
};

export const toastState: PrimitiveAtom<ToastState> & {
  init: ToastState;
} = atom<ToastState>({
  id: 0,
  open: false,
  message: '',
  severity: NotificationSeverity.SUCCESS,
  showIcon: true,
  duration: 0,
});
