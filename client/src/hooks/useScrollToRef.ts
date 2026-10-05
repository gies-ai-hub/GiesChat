import { RefObject, useCallback } from 'react';
import throttle from 'lodash/throttle';

type TUseScrollToRef = {
  /** The element that scrolls; only it moves, never the page around it. */
  containerRef: RefObject<HTMLDivElement>;
  callback: () => void;
  smoothCallback: () => void;
};

type ThrottledFunction = (() => void) & {
  cancel: () => void;
  flush: () => void;
};

type ScrollToRefReturn = {
  scrollToRef?: ThrottledFunction;
  handleSmoothToRef: React.MouseEventHandler<HTMLButtonElement>;
};

export default function useScrollToRef({
  containerRef,
  callback,
  smoothCallback,
}: TUseScrollToRef): ScrollToRefReturn {
  /**
   * Not `scrollIntoView` on an end marker: that also scrolls every ancestor, which inside
   * an embedded iframe drags the host page down to the frame on every streamed token.
   */
  const logAndScroll = (behavior: 'instant' | 'smooth', callbackFn: () => void) => {
    const container = containerRef.current;
    container?.scrollTo({ top: container.scrollHeight, behavior });
    callbackFn();
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const scrollToRef = useCallback(
    throttle(() => logAndScroll('instant', callback), 145, { leading: true }),
    [containerRef],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const scrollToRefSmooth = useCallback(
    throttle(() => logAndScroll('smooth', smoothCallback), 750, { leading: true }),
    [containerRef],
  );

  const handleSmoothToRef: React.MouseEventHandler<HTMLButtonElement> = (e) => {
    e.preventDefault();
    scrollToRefSmooth();
  };

  return {
    scrollToRef,
    handleSmoothToRef,
  };
}
