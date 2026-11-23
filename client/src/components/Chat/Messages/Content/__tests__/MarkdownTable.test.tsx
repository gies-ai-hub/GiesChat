import React from 'react';
import { render, screen } from '@testing-library/react';
import { table as MarkdownTable } from '../MarkdownComponents';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) =>
    key === 'com_ui_table_scroll_region' ? 'Table, scrolls sideways' : key,
}));

let observed: ResizeObserverCallback | undefined;

beforeAll(() => {
  global.ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) {
      observed = callback;
    }

    observe() {}
    disconnect() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
});

function renderTable(scrollWidth: number, clientWidth: number) {
  jest.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(scrollWidth);
  jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(clientWidth);
  return render(
    <MarkdownTable>
      <tbody>
        <tr>
          <td>NPV</td>
        </tr>
      </tbody>
    </MarkdownTable>,
  );
}

afterEach(() => jest.restoreAllMocks());

describe('MarkdownTable', () => {
  it('makes a wide table a focusable, named region', () => {
    renderTable(900, 400);
    const region = screen.getByRole('region', { name: 'Table, scrolls sideways' });
    expect(region).toHaveAttribute('tabindex', '0');
    expect(observed).toBeDefined();
  });

  it('adds no tab stop when the table fits', () => {
    const { container } = renderTable(300, 400);
    expect(screen.queryByRole('region')).toBeNull();
    expect(container.querySelector('.markdown-table-wrapper')).not.toHaveAttribute('tabindex');
  });
});
