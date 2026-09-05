/** The analytics panels a professor can arrange. Order here is the default order. */
export const ADMIN_PANEL_IDS = ['kpi', 'activity', 'topics', 'reach', 'depth', 'signals'] as const;

export type AdminPanelId = (typeof ADMIN_PANEL_IDS)[number];

/** One entry of a saved layout. The array order IS the panel order. */
export interface AdminDashboardPanel {
  id: AdminPanelId;
  visible: boolean;
}

/** How much of a row a panel wants. */
export type AdminPanelSpan = 'full' | 'wide' | 'narrow';

/** Five columns, so wide:narrow is 3:2 — exactly the dashboard's original `[1.5fr_1fr]`. */
export const GRID_COLUMNS = 5;

export const PANEL_COLUMNS: Record<AdminPanelSpan, number> = {
  full: 5,
  wide: 3,
  narrow: 2,
};

export function isAdminPanelId(value: unknown): value is AdminPanelId {
  return typeof value === 'string' && (ADMIN_PANEL_IDS as readonly string[]).includes(value);
}

/**
 * Narrows an untrusted layout — a request body or a document written by an older
 * build — into entries this build understands. Unknown ids, duplicates, and
 * non-objects are dropped rather than rejected, so one stale id can never make a
 * professor's whole dashboard unreadable.
 */
export function sanitizeLayout(input: unknown): AdminDashboardPanel[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const seen = new Set<AdminPanelId>();
  const panels: AdminDashboardPanel[] = [];
  for (const entry of input) {
    if (entry === null || typeof entry !== 'object') {
      continue;
    }
    const { id, visible } = entry as { id?: unknown; visible?: unknown };
    if (!isAdminPanelId(id) || seen.has(id)) {
      continue;
    }
    seen.add(id);
    panels.push({ id, visible: visible !== false });
  }
  return panels;
}

/**
 * A saved layout is a snapshot of the registry on the day it was saved, so reading
 * it is a merge: keep what still exists in stored order, then append anything the
 * layout has never seen. A panel added next semester therefore appears for every
 * professor with no migration.
 */
export function resolveLayout(
  stored: AdminDashboardPanel[] | null | undefined,
  order: readonly AdminPanelId[] = ADMIN_PANEL_IDS,
): AdminDashboardPanel[] {
  const known = new Set<AdminPanelId>(order);
  const kept = sanitizeLayout(stored).filter((panel) => known.has(panel.id));
  const seen = new Set(kept.map((panel) => panel.id));
  const added = order.filter((id) => !seen.has(id)).map((id) => ({ id, visible: true }));
  return [...kept, ...added];
}

export interface PackedPanel<T> {
  panel: T;
  columns: number;
}

/**
 * Flows panels into fixed-width rows, widening a row's last panel to absorb any
 * remainder. Without this, hiding one narrow panel would leave dead columns beside
 * its neighbour, which reads as a rendering bug rather than a choice.
 */
export function packRows<T>(panels: T[], columnsOf: (panel: T) => number): PackedPanel<T>[] {
  const packed: PackedPanel<T>[] = [];
  let used = 0;

  const closeRow = () => {
    const last = packed[packed.length - 1];
    if (used > 0 && used < GRID_COLUMNS && last !== undefined) {
      last.columns += GRID_COLUMNS - used;
    }
    used = 0;
  };

  for (const panel of panels) {
    const columns = Math.min(Math.max(columnsOf(panel), 1), GRID_COLUMNS);
    if (used + columns > GRID_COLUMNS) {
      closeRow();
    }
    packed.push({ panel, columns });
    used += columns;
    if (used === GRID_COLUMNS) {
      used = 0;
    }
  }
  closeRow();

  return packed;
}
