import { ADMIN_PANEL_IDS, PANEL_COLUMNS } from 'librechat-data-provider';
import { PANEL_ORDER, PANEL_REGISTRY, columnsFor, panelFor, SPAN_CLASS } from '../registry';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

describe('panel registry', () => {
  it('covers every contract id exactly once, in contract order', () => {
    expect(PANEL_ORDER).toEqual([...ADMIN_PANEL_IDS]);
  });

  it('gives every panel a component and a label', () => {
    for (const definition of PANEL_REGISTRY) {
      expect(typeof definition.Component).toBe('function');
      expect(definition.labelKey).toMatch(/^com_ui_admin_panel_/);
    }
  });

  it('reproduces the dashboard’s original layout widths', () => {
    expect(columnsFor('kpi')).toBe(PANEL_COLUMNS.full);
    expect(columnsFor('activity')).toBe(PANEL_COLUMNS.full);
    expect(columnsFor('reach')).toBe(PANEL_COLUMNS.narrow);
    expect(columnsFor('depth')).toBe(PANEL_COLUMNS.wide);
    expect(columnsFor('signals')).toBe(PANEL_COLUMNS.narrow);
  });

  it('resolves a definition by id', () => {
    expect(panelFor('signals')?.id).toBe('signals');
  });

  it('has a static Tailwind class for every reachable column count', () => {
    for (let columns = 1; columns <= 5; columns += 1) {
      expect(SPAN_CLASS[columns]).toBe(`lg:col-span-${columns}`);
    }
  });
});
