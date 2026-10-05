import { renderHook } from '@testing-library/react';
import useScrollToRef from '../useScrollToRef';

describe('useScrollToRef', () => {
  it('scrolls only its container, never the page around it (embedded iframes)', () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'scrollHeight', { value: 900 });
    container.scrollTo = jest.fn();
    const scrollIntoView = jest.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const callback = jest.fn();

    const { result } = renderHook(() =>
      useScrollToRef({ containerRef: { current: container }, callback, smoothCallback: jest.fn() }),
    );
    result.current.scrollToRef?.();

    expect(container.scrollTo).toHaveBeenCalledWith({ top: 900, behavior: 'instant' });
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
