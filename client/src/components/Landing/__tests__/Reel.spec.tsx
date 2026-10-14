import { render, screen, fireEvent, act } from '@testing-library/react';
import Reel from '../Reel';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

const pressedTab = () =>
  screen.getAllByRole('button').findIndex((tab) => tab.getAttribute('aria-pressed') === 'true');

const advance = (ms: number) =>
  act(() => {
    for (let t = 0; t < ms; t += 50) {
      jest.advanceTimersByTime(50);
    }
  });

describe('Reel', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    window.matchMedia = jest.fn().mockReturnValue({ matches: false });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('advances to the next feature on its own and wraps around', () => {
    render(<Reel />);
    expect(pressedTab()).toBe(0);
    advance(4200);
    expect(pressedTab()).toBe(1);
    advance(4100 * 4);
    expect(pressedTab()).toBe(0);
  });

  it('jumps to a clicked feature and holds while hovered', () => {
    const { container } = render(<Reel />);
    fireEvent.click(screen.getByText('com_ui_landing_tab_dashboard'));
    expect(pressedTab()).toBe(3);
    fireEvent.mouseEnter(container.firstChild as Element);
    advance(15000);
    expect(pressedTab()).toBe(3);
  });

  it('stops advancing when paused and resumes on play (WCAG 2.2.2)', () => {
    render(<Reel />);
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_landing_reel_pause' }));
    advance(15000);
    expect(pressedTab()).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_landing_reel_play' }));
    advance(4200);
    expect(pressedTab()).toBe(1);
  });

  it('stays on the first feature when the visitor prefers reduced motion', () => {
    window.matchMedia = jest.fn().mockReturnValue({ matches: true });
    render(<Reel />);
    advance(15000);
    expect(pressedTab()).toBe(0);
  });
});
