import { PANEL_COLUMNS } from 'librechat-data-provider';
import type {
  AdminPanelId,
  AdminPanelSpan,
  AdminUsageParams,
  AdminAnalyticsResponse,
} from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import type { ComponentType } from 'react';
import { KpiRow, ActivityPanel, TopicsPanel, ReachPanel, DepthPanel, SignalsPanel } from './Panels';

export interface PanelDefinition {
  id: AdminPanelId;
  labelKey: TranslationKeys;
  span: AdminPanelSpan;
  Component: ComponentType<{ data: AdminAnalyticsResponse; params: AdminUsageParams }>;
}

/**
 * Single source of truth for id → component, label, and grid appetite. A new panel is
 * one entry here: the contract, the merge rule, and the Customize list all follow.
 */
export const PANEL_REGISTRY: PanelDefinition[] = [
  { id: 'kpi', labelKey: 'com_ui_admin_panel_kpi', span: 'full', Component: KpiRow },
  {
    id: 'activity',
    labelKey: 'com_ui_admin_panel_activity',
    span: 'wide',
    Component: ActivityPanel,
  },
  { id: 'topics', labelKey: 'com_ui_admin_panel_topics', span: 'narrow', Component: TopicsPanel },
  { id: 'reach', labelKey: 'com_ui_admin_panel_reach', span: 'narrow', Component: ReachPanel },
  { id: 'depth', labelKey: 'com_ui_admin_panel_depth', span: 'wide', Component: DepthPanel },
  {
    id: 'signals',
    labelKey: 'com_ui_admin_panel_signals',
    span: 'narrow',
    Component: SignalsPanel,
  },
];

const BY_ID = new Map<AdminPanelId, PanelDefinition>(
  PANEL_REGISTRY.map((definition) => [definition.id, definition]),
);

export const PANEL_ORDER: AdminPanelId[] = PANEL_REGISTRY.map((definition) => definition.id);

export function panelFor(id: AdminPanelId): PanelDefinition | undefined {
  return BY_ID.get(id);
}

export function columnsFor(id: AdminPanelId): number {
  const definition = BY_ID.get(id);
  return definition === undefined ? PANEL_COLUMNS.narrow : PANEL_COLUMNS[definition.span];
}

/**
 * Tailwind compiles class names statically, so a template literal like
 * `lg:col-span-${n}` produces no CSS at all. These five must be written out.
 */
export const SPAN_CLASS: Record<number, string> = {
  1: 'lg:col-span-1',
  2: 'lg:col-span-2',
  3: 'lg:col-span-3',
  4: 'lg:col-span-4',
  5: 'lg:col-span-5',
};
