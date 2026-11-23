import { Provider } from 'jotai';
import * as RadixToast from '@radix-ui/react-toast';
import { act, render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { TShowToast } from '~/common';
import { toastDuration, TOAST_DURATION } from '~/hooks/useToast';
import ToastProvider, { useToastContext } from '~/Providers/ToastContext';
import { NotificationSeverity } from '~/common';
import { Toast } from './Toast';

let show: (toast: TShowToast) => void = () => undefined;

function Capture() {
  show = useToastContext().showToast;
  return null;
}

function renderToasts() {
  render(
    <Provider>
      <RadixToast.Provider>
        <ToastProvider>
          <Capture />
          <Toast />
          <RadixToast.Viewport />
        </ToastProvider>
      </RadixToast.Provider>
    </Provider>,
  );
}

const showNow = (toast: TShowToast) =>
  act(() => {
    show(toast);
    jest.advanceTimersByTime(100);
  });

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('toastDuration', () => {
  it('keeps errors until closed and everything else at least the default', () => {
    expect(toastDuration(NotificationSeverity.ERROR, 3000)).toBe(Infinity);
    expect(toastDuration(NotificationSeverity.SUCCESS)).toBe(TOAST_DURATION);
    expect(toastDuration(NotificationSeverity.INFO, 750)).toBe(TOAST_DURATION);
    expect(toastDuration(NotificationSeverity.WARNING, 10000)).toBe(10000);
  });
});

describe('Toast', () => {
  it('leaves an error up until its Close button is pressed', () => {
    renderToasts();
    showNow({ message: "Couldn't save", severity: NotificationSeverity.ERROR });
    act(() => {
      jest.advanceTimersByTime(60000);
    });
    expect(screen.getAllByText("Couldn't save").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_close' }));
    expect(screen.queryByRole('button', { name: 'com_ui_close' })).not.toBeInTheDocument();
  });

  it('keeps a short success toast up for the default time, not the 3 s callers used to get', () => {
    renderToasts();
    showNow({ message: 'Saved', duration: 3000 });
    act(() => {
      jest.advanceTimersByTime(TOAST_DURATION - 500);
    });
    expect(screen.getByRole('button', { name: 'com_ui_close' })).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(screen.queryByRole('button', { name: 'com_ui_close' })).not.toBeInTheDocument();
  });

  it('pauses while focus is inside the toast', () => {
    renderToasts();
    showNow({ message: 'Saved' });
    act(() => {
      screen.getByRole('button', { name: 'com_ui_close' }).focus();
      jest.advanceTimersByTime(TOAST_DURATION * 3);
    });
    expect(screen.getByRole('button', { name: 'com_ui_close' })).toBeInTheDocument();
  });

  it('restarts the timer when a new toast replaces an open one', () => {
    renderToasts();
    showNow({ message: 'First' });
    act(() => {
      jest.advanceTimersByTime(TOAST_DURATION - 1000);
    });
    showNow({ message: 'Second' });
    act(() => {
      jest.advanceTimersByTime(TOAST_DURATION - 1000);
    });
    expect(screen.getAllByText('Second').length).toBeGreaterThan(0);
  });
});
