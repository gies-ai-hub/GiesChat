import React from 'react';
import { render, screen, within, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { AdminAnalyticsResponse } from 'librechat-data-provider';
import { KpiRow, ActivityPanel, ReachPanel, DepthPanel, SignalsPanel } from '../Panels';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, string | number>) =>
    values === undefined ? key : `${key}:${Object.values(values).join(',')}`,
}));

const data: AdminAnalyticsResponse = {
  activeStudents: 38,
  enrolledStudents: 52,
  conversationCount: 214,
  medianTurns: 4,
  returnRate: 0.605,
  dailyActivity: [
    { date: '2026-07-01', conversationCount: 4 },
    { date: '2026-07-02', conversationCount: 9 },
    { date: '2026-07-03', conversationCount: 2 },
  ],
  reachBuckets: [
    { label: '1', count: 9 },
    { label: '2–4', count: 14 },
    { label: '5–9', count: 10 },
    { label: '10+', count: 5 },
  ],
  depthBuckets: [
    { label: '1', count: 47 },
    { label: '2', count: 58 },
    { label: '3', count: 44 },
    { label: '4–5', count: 39 },
    { label: '6–9', count: 20 },
    { label: '10+', count: 6 },
  ],
  oneTurnShare: 0.22,
  errorRate: 0.031,
};

const dayFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});
const day = (date: string) => dayFormat.format(new Date(date));
const range = dayFormat.formatRange(new Date('2026-07-01'), new Date('2026-07-03'));

/** Opens the panel's Show data disclosure, then reads header row and data rows as cell text. */
const tableRows = async (name: RegExp) => {
  fireEvent.click(screen.getByText('com_ui_admin_analytics_show_data'));
  return within(await screen.findByRole('table', { name }))
    .getAllByRole('row')
    .map((row) => Array.from(row.querySelectorAll('th, td'), (cell) => cell.textContent));
};

describe('KpiRow', () => {
  it('shows the headline figures', () => {
    render(<KpiRow data={data} />);

    expect(screen.getByText('38')).toBeInTheDocument();
    expect(screen.getByText('214')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('61%')).toBeInTheDocument();
  });

  it('reports conversations per active student without dividing by zero', () => {
    render(<KpiRow data={{ ...data, activeStudents: 0, conversationCount: 0 }} />);

    expect(screen.getByText(/com_ui_admin_analytics_per_student:0/)).toBeInTheDocument();
  });
});

describe('ActivityPanel', () => {
  it('plots one point per day in the window', () => {
    const { container } = render(<ActivityPanel data={data} />);

    const path = container.querySelector('path[data-line]');
    expect(path?.getAttribute('d')?.match(/[ML]/g)).toHaveLength(3);
  });

  it('survives a window with a single day', () => {
    const single = { ...data, dailyActivity: [{ date: '2026-07-01', conversationCount: 3 }] };
    const { container } = render(<ActivityPanel data={single} />);

    expect(container.querySelector('path[data-line]')).toBeInTheDocument();
  });

  it('shows no tooltip until the pointer is over the plot', () => {
    render(<ActivityPanel data={data} />);

    expect(screen.queryByTestId('chart-tooltip')).not.toBeInTheDocument();
  });

  it('reveals the day under the pointer, and hides it again on leave', () => {
    const { container } = render(<ActivityPanel data={data} />);
    const surface = container.querySelector('[data-hover-surface]') as SVGRectElement;

    fireEvent.pointerMove(surface, { clientX: 0 });
    expect(screen.getByTestId('chart-tooltip')).toHaveTextContent(day('2026-07-01'));
    expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('4');

    fireEvent.pointerLeave(surface);
    expect(screen.queryByTestId('chart-tooltip')).not.toBeInTheDocument();
  });

  it('marks the hovered point on the line', () => {
    const { container } = render(<ActivityPanel data={data} />);
    const surface = container.querySelector('[data-hover-surface]') as SVGRectElement;

    expect(container.querySelector('[data-hover-marker]')).not.toBeInTheDocument();
    fireEvent.pointerMove(surface, { clientX: 0 });
    expect(container.querySelector('[data-hover-marker]')).toBeInTheDocument();
  });

  it('lists every day in a collapsed Show data table and hides the chart from screen readers', async () => {
    const { container } = render(<ActivityPanel data={data} />);

    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('details')).not.toHaveAttribute('open');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('com_ui_admin_analytics_show_data').tagName).toBe('SUMMARY');
    expect(
      await tableRows(
        new RegExp(`com_ui_admin_analytics_data_caption:com_ui_admin_analytics_activity,${range}`),
      ),
    ).toEqual([
      ['com_ui_admin_analytics_day', 'com_ui_admin_analytics_conversations'],
      [day('2026-07-01'), '4'],
      [day('2026-07-02'), '9'],
      [day('2026-07-03'), '2'],
    ]);
  });
});

describe('ReachPanel', () => {
  it('renders the meter when a class is selected', () => {
    render(<ReachPanel data={data} />);

    const meter = screen.getByRole('meter');
    expect(meter).toHaveAttribute('aria-valuenow', '38');
    expect(meter).toHaveAttribute('aria-valuemax', '52');
  });

  it('hides the meter when the roster size is unknown', () => {
    render(<ReachPanel data={{ ...data, enrolledStudents: 38 }} />);

    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  });

  it('tabulates repeat use with its unit and each bucket share', async () => {
    render(<ReachPanel data={data} />);

    expect(await tableRows(/com_ui_admin_analytics_repeat/)).toEqual([
      [
        'com_ui_admin_analytics_conversations_per_student',
        'com_ui_admin_analytics_reach_unit',
        'com_ui_admin_analytics_share',
      ],
      ['1', '9', '24%'],
      ['2–4', '14', '37%'],
      ['5–9', '10', '26%'],
      ['10+', '5', '13%'],
    ]);
  });
});

describe('DepthPanel', () => {
  it('draws one column per bucket', () => {
    const { container } = render(<DepthPanel data={data} />);

    expect(container.querySelectorAll('rect[data-bar]')).toHaveLength(6);
  });

  it('reveals a bucket tooltip on hover with its share of the total', () => {
    const { container } = render(<DepthPanel data={data} />);
    const targets = container.querySelectorAll('[data-hover-bar]');

    fireEvent.pointerEnter(targets[0]);
    const tooltip = screen.getByTestId('chart-tooltip');
    expect(tooltip).toHaveTextContent('47');
    /** 47 of 214 conversations. */
    expect(tooltip).toHaveTextContent('22%');

    fireEvent.pointerLeave(targets[0]);
    expect(screen.queryByTestId('chart-tooltip')).not.toBeInTheDocument();
  });

  it('tabulates every bucket the chart draws, unit and share included', async () => {
    const { container } = render(<DepthPanel data={data} />);

    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    const rows = await tableRows(/com_ui_admin_analytics_depth/);
    expect(rows[0]).toEqual([
      'com_ui_admin_analytics_turns_per_conversation',
      'com_ui_admin_analytics_conversations',
      'com_ui_admin_analytics_share',
    ]);
    expect(rows.slice(1).map(([label, count]) => [label, count])).toEqual(
      data.depthBuckets.map((bucket) => [bucket.label, String(bucket.count)]),
    );
    /** 47 of 214 conversations, the same share the tooltip shows. */
    expect(rows[1][2]).toBe('22%');
  });

  it('renders nothing to divide by when every bucket is empty', () => {
    const empty = { ...data, depthBuckets: data.depthBuckets.map((b) => ({ ...b, count: 0 })) };
    const { container } = render(<DepthPanel data={empty} />);

    const heights = Array.from(container.querySelectorAll('rect[data-bar]')).map((bar) =>
      Number(bar.getAttribute('height')),
    );
    expect(heights.every((height) => height === 0)).toBe(true);
  });
});

describe('SignalsPanel', () => {
  it('states the one-turn share, the never-used count, errors, and returns', () => {
    render(<SignalsPanel data={data} />);

    expect(screen.getByText(/com_ui_admin_analytics_one_turn:22/)).toBeInTheDocument();
    expect(screen.getByText(/com_ui_admin_analytics_never_used:14/)).toBeInTheDocument();
    expect(screen.getByText(/com_ui_admin_analytics_errors:3.1/)).toBeInTheDocument();
    expect(screen.getByText(/com_ui_admin_analytics_returned:61/)).toBeInTheDocument();
  });

  it('never reports a negative never-used count', () => {
    render(<SignalsPanel data={{ ...data, enrolledStudents: 10, activeStudents: 38 }} />);

    expect(screen.getByText(/com_ui_admin_analytics_never_used:0/)).toBeInTheDocument();
  });
});
