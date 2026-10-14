import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import Faculty from '../Faculty';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

const CTA = 'sign in';

const visibleScreens = (container: HTMLElement) =>
  [...container.querySelectorAll('.lp-tour-screen')].map((el) => !el.hasAttribute('hidden'));

describe('Faculty', () => {
  beforeEach(() => {
    window.matchMedia = jest.fn().mockReturnValue({ matches: true });
  });

  it('opens on the build step and shows only its screen', () => {
    const { container } = render(<Faculty>{CTA}</Faculty>);
    expect(screen.getByRole('button', { name: /com_ui_landing_tour_build\b/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(visibleScreens(container)).toEqual([true, false, false, false]);
    expect(screen.getByText('com_ui_landing_tour_create')).toBeVisible();
  });

  it('swaps to the Canvas screen when its step is clicked', () => {
    const { container } = render(<Faculty>{CTA}</Faculty>);
    const share = screen.getByRole('button', { name: /com_ui_landing_tour_share\b/ });
    fireEvent.click(share);
    expect(share).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /com_ui_landing_tour_build\b/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(visibleScreens(container)).toEqual([false, false, true, false]);
    expect(screen.getByText('com_ui_landing_tour_paste')).toBeInTheDocument();
  });

  it('renders the calls to action it is given', () => {
    render(
      <Faculty>
        <a href="/login">{CTA}</a>
      </Faculty>,
    );
    expect(screen.getByRole('link', { name: CTA })).toBeInTheDocument();
  });
});
