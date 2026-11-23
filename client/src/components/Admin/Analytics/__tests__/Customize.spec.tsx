import React from 'react';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { AdminDashboardPanel } from 'librechat-data-provider';
import AnnouncerContext from '~/Providers/AnnouncerContext';
import Customize from '../Customize';

const mockMutate = jest.fn();
const mockShowToast = jest.fn();
const mockAnnounce = jest.fn();

jest.mock('~/data-provider', () => ({
  useUpdateAdminDashboardLayoutMutation: () => ({ mutate: mockMutate }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, string | number>) =>
    values === undefined ? key : `${key}:${Object.values(values).join(',')}`,
}));

jest.mock('@librechat/client', () => {
  const actual = jest.requireActual('@librechat/client');
  return { ...actual, useToastContext: () => ({ showToast: mockShowToast }) };
});

const layout: AdminDashboardPanel[] = [
  { id: 'kpi', visible: true },
  { id: 'activity', visible: true },
  { id: 'reach', visible: false },
  { id: 'depth', visible: true },
  { id: 'signals', visible: true },
];

/** `DndProvider` lives in `App.jsx` in the real app; a bare render has no drag context. */
const renderCustomize = () =>
  render(
    <AnnouncerContext.Provider
      value={{ announcePolite: mockAnnounce, announceAssertive: mockAnnounce }}
    >
      <DndProvider backend={HTML5Backend}>
        <Customize layout={layout} />
      </DndProvider>
    </AnnouncerContext.Provider>,
  );

const open = () => fireEvent.click(screen.getByRole('button', { name: 'com_ui_admin_customize' }));

const moveButton = (direction: 'up' | 'down', id: string) =>
  screen.getByRole('button', {
    name: `com_ui_admin_customize_move_${direction}:com_ui_admin_panel_${id}`,
  });

const order = () =>
  screen
    .getAllByRole('checkbox')
    .map((box) => box.getAttribute('aria-label')?.replace('com_ui_admin_panel_', ''));

describe('Customize', () => {
  beforeEach(() => {
    mockMutate.mockClear();
    mockShowToast.mockClear();
    mockAnnounce.mockClear();
  });

  it('lists every panel with its stored visibility', () => {
    renderCustomize();
    open();

    expect(screen.getByRole('checkbox', { name: 'com_ui_admin_panel_kpi' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'com_ui_admin_panel_reach' })).not.toBeChecked();
  });

  it('does not save on every click — only when the dialog closes', () => {
    renderCustomize();
    open();
    fireEvent.click(screen.getByRole('checkbox', { name: 'com_ui_admin_panel_depth' }));

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('saves the edited layout when the dialog closes', () => {
    renderCustomize();
    open();
    fireEvent.click(screen.getByRole('checkbox', { name: 'com_ui_admin_panel_depth' }));
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_admin_customize_done' }));

    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate.mock.calls[0][0]).toEqual([
      { id: 'kpi', visible: true },
      { id: 'activity', visible: true },
      { id: 'reach', visible: false },
      { id: 'depth', visible: false },
      { id: 'signals', visible: true },
    ]);
  });

  it('restores every panel when Reset is clicked', () => {
    renderCustomize();
    open();
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_admin_customize_reset' }));

    expect(screen.getByRole('checkbox', { name: 'com_ui_admin_panel_reach' })).toBeChecked();
  });

  it('disables Move up on the first panel and Move down on the last', () => {
    renderCustomize();
    open();

    expect(moveButton('up', 'kpi')).toBeDisabled();
    expect(moveButton('down', 'kpi')).toBeEnabled();
    expect(moveButton('up', 'signals')).toBeEnabled();
    expect(moveButton('down', 'signals')).toBeDisabled();
  });

  it('reorders with the Move buttons, announces the new position, and saves on close', () => {
    renderCustomize();
    open();
    fireEvent.click(moveButton('up', 'depth'));

    expect(order()).toEqual(['kpi', 'activity', 'depth', 'reach', 'signals']);
    expect(mockAnnounce).toHaveBeenCalledWith({
      message: 'com_ui_admin_customize_moved:com_ui_admin_panel_depth,3,5',
      isStatus: true,
    });

    fireEvent.click(moveButton('down', 'kpi'));
    expect(order()).toEqual(['activity', 'kpi', 'depth', 'reach', 'signals']);

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_admin_customize_done' }));
    expect(mockMutate.mock.calls[0][0].map((panel: AdminDashboardPanel) => panel.id)).toEqual([
      'activity',
      'kpi',
      'depth',
      'reach',
      'signals',
    ]);
  });

  it('keeps focus on the moved panel, hopping to its other button at an end', () => {
    renderCustomize();
    open();

    fireEvent.click(moveButton('down', 'kpi'));
    expect(moveButton('down', 'kpi')).toHaveFocus();

    fireEvent.click(moveButton('down', 'depth'));
    expect(moveButton('up', 'depth')).toHaveFocus();

    fireEvent.click(moveButton('up', 'kpi'));
    expect(moveButton('down', 'kpi')).toHaveFocus();
  });

  it('does not save when nothing changed', () => {
    renderCustomize();
    open();
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_admin_customize_done' }));

    expect(mockMutate).not.toHaveBeenCalled();
  });
});
