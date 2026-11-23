import React, { useRef, useMemo, useState, useEffect, useCallback } from 'react';
import { useDrag, useDrop } from 'react-dnd';
import { ArrowUp, ArrowDown, GripVertical, SlidersHorizontal } from 'lucide-react';
import { resolveLayout } from 'librechat-data-provider';
import {
  Button,
  OGDialog,
  OGDialogTitle,
  OGDialogContent,
  useToastContext,
} from '@librechat/client';
import type { AdminDashboardPanel, AdminPanelId } from 'librechat-data-provider';
import { useUpdateAdminDashboardLayoutMutation } from '~/data-provider';
import { PANEL_ORDER, panelFor } from './registry';
import { useLiveAnnouncer } from '~/Providers';
import { useLocalize } from '~/hooks';

const DRAG_TYPE = 'admin-analytics-panel';

/** Order and visibility are the whole layout, so this is a complete equality check. */
const signature = (panels: AdminDashboardPanel[]): string =>
  panels.map((panel) => `${panel.id}:${panel.visible ? 1 : 0}`).join('|');

type Direction = 'up' | 'down';

const moveButtonId = (id: AdminPanelId, direction: Direction): string =>
  `admin-panel-${id}-${direction}`;

/** A button disabled by the move can't hold focus, so focus hops to its twin. */
function focusAfter(to: number, count: number, direction: Direction): Direction {
  if (to === 0) {
    return 'down';
  }
  if (to === count - 1) {
    return 'up';
  }
  return direction;
}

interface RowProps {
  panel: AdminDashboardPanel;
  index: number;
  count: number;
  label: string;
  onToggle: (id: AdminPanelId) => void;
  onMove: (from: number, to: number) => void;
  onStep: (index: number, direction: Direction, label: string) => void;
}

/** Dragging stays as a shortcut; the arrow buttons are the keyboard and single-pointer route. */
function Row({ panel, index, count, label, onToggle, onMove, onStep }: RowProps) {
  const localize = useLocalize();
  const ref = useRef<HTMLDivElement>(null);

  const [, drop] = useDrop<{ index: number }>({
    accept: DRAG_TYPE,
    hover(item) {
      if (item.index === index) {
        return;
      }
      onMove(item.index, index);
      item.index = index;
    },
  });

  const [{ isDragging }, drag] = useDrag({
    type: DRAG_TYPE,
    item: () => ({ index }),
    collect: (monitor) => ({ isDragging: monitor.isDragging() }),
  });

  drag(drop(ref));

  return (
    <div
      ref={ref}
      className={`flex items-center gap-3 rounded-lg border border-border-light px-3 py-2 ${
        isDragging ? 'opacity-40' : ''
      }`}
    >
      <GripVertical
        className="size-4 shrink-0 cursor-grab text-text-secondary"
        aria-hidden="true"
      />
      <input
        type="checkbox"
        id={`admin-panel-${panel.id}`}
        checked={panel.visible}
        onChange={() => onToggle(panel.id)}
        aria-label={label}
        className="size-4"
      />
      <label htmlFor={`admin-panel-${panel.id}`} className="text-sm text-text-primary">
        {label}
      </label>
      <div className="ml-auto flex shrink-0 gap-1">
        <Button
          id={moveButtonId(panel.id, 'up')}
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          disabled={index === 0}
          aria-label={localize('com_ui_admin_customize_move_up', { name: label })}
          onClick={() => onStep(index, 'up', label)}
        >
          <ArrowUp className="size-4" aria-hidden="true" />
        </Button>
        <Button
          id={moveButtonId(panel.id, 'down')}
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          disabled={index === count - 1}
          aria-label={localize('com_ui_admin_customize_move_down', { name: label })}
          onClick={() => onStep(index, 'down', label)}
        >
          <ArrowDown className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

/**
 * Edits are held locally so the dashboard reflows live behind the dialog; the save
 * fires once when the dialog closes rather than once per checkbox click.
 */
export default function Customize({ layout }: { layout: AdminDashboardPanel[] }) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { announcePolite } = useLiveAnnouncer();
  const { mutate } = useUpdateAdminDashboardLayoutMutation();
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState<AdminDashboardPanel[]>(layout);
  /** React re-inserts a row moved down, which drops focus; this puts it back. */
  const focusId = useRef<string | null>(null);

  useEffect(() => {
    const id = focusId.current;
    focusId.current = null;
    if (id != null) {
      document.getElementById(id)?.focus();
    }
  }, [draft]);

  const defaultLayout = useMemo(() => resolveLayout([], PANEL_ORDER), []);

  const handleToggle = useCallback((id: AdminPanelId) => {
    setDraft((current) =>
      current.map((panel) => (panel.id === id ? { ...panel, visible: !panel.visible } : panel)),
    );
  }, []);

  const handleMove = useCallback((from: number, to: number) => {
    setDraft((current) => {
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  const handleStep = useCallback(
    (index: number, direction: Direction, label: string) => {
      const to = direction === 'up' ? index - 1 : index + 1;
      if (to < 0 || to >= draft.length) {
        return;
      }
      focusId.current = moveButtonId(draft[index].id, focusAfter(to, draft.length, direction));
      handleMove(index, to);
      announcePolite({
        message: localize('com_ui_admin_customize_moved', {
          name: label,
          position: to + 1,
          total: draft.length,
        }),
        isStatus: true,
      });
    },
    [draft, handleMove, announcePolite, localize],
  );

  const handleReset = useCallback(() => setDraft(defaultLayout), [defaultLayout]);

  /**
   * Closing is the save. `signature` guards the two ways that can fire twice — an
   * explicit Done plus Radix's own unmount `onOpenChange` — and also skips the
   * request entirely when a professor opened the dialog and changed nothing.
   */
  const handleOpenChange = useCallback(
    (open: boolean) => {
      setIsOpen(open);
      if (open) {
        setDraft(layout);
        return;
      }
      if (signature(draft) === signature(layout)) {
        return;
      }
      mutate(draft, {
        onError: () => showToast({ message: localize('com_ui_admin_customize_error') }),
      });
    },
    [draft, layout, mutate, showToast, localize],
  );

  return (
    <>
      <Button variant="outline" onClick={() => handleOpenChange(true)}>
        <SlidersHorizontal className="mr-2 size-4" aria-hidden="true" />
        {localize('com_ui_admin_customize')}
      </Button>
      <OGDialog open={isOpen} onOpenChange={handleOpenChange}>
        <OGDialogContent className="w-11/12 max-w-sm">
          <OGDialogTitle>{localize('com_ui_admin_customize_title')}</OGDialogTitle>
          <div className="grid gap-2 py-2">
            {draft.map((panel, index) => {
              const definition = panelFor(panel.id);
              if (definition === undefined) {
                return null;
              }
              const label = localize(definition.labelKey);
              return (
                <Row
                  key={panel.id}
                  panel={panel}
                  index={index}
                  count={draft.length}
                  label={label}
                  onToggle={handleToggle}
                  onMove={handleMove}
                  onStep={handleStep}
                />
              );
            })}
          </div>
          <div className="flex items-center justify-between gap-2">
            <Button variant="ghost" onClick={handleReset} className="px-2">
              {localize('com_ui_admin_customize_reset')}
            </Button>
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              {localize('com_ui_admin_customize_done')}
            </Button>
          </div>
        </OGDialogContent>
      </OGDialog>
    </>
  );
}
