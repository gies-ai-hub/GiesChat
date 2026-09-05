import React, { useMemo, useCallback } from 'react';
import { packRows, resolveLayout } from 'librechat-data-provider';
import { useAdminAgentAnalyticsQuery, useAdminDashboardLayoutQuery } from '~/data-provider';
import { PANEL_ORDER, SPAN_CLASS, columnsFor, panelFor } from './registry';
import { useLocalize } from '~/hooks';
import QueryState from '../QueryState';
import Customize from './Customize';

interface AnalyticsSectionProps {
  /** Empty string means unfiltered, matching how the tables read the class filter. */
  groupId: string;
  days: number;
}

/**
 * Class-wide activity for the agents the caller can edit. Aggregate only — the
 * endpoint identifies no student, and neither does anything rendered here.
 *
 * Panels render from the caller's saved layout. A failed or absent layout resolves to
 * the default, which packs to exactly the grid this section used before it became
 * customizable — a display preference must never be able to take the analytics down.
 */
export default function AnalyticsSection({ groupId, days }: AnalyticsSectionProps) {
  const localize = useLocalize();
  const params = { days, ...(groupId ? { groupId } : {}) };
  const { data, isLoading, error, refetch } = useAdminAgentAnalyticsQuery(params);
  const { data: layoutData } = useAdminDashboardLayoutQuery();

  const layout = useMemo(() => resolveLayout(layoutData?.panels, PANEL_ORDER), [layoutData]);

  const packed = useMemo(
    () =>
      packRows(
        layout.filter((panel) => panel.visible),
        (panel) => columnsFor(panel.id),
      ),
    [layout],
  );

  const handleRetry = useCallback(() => {
    void refetch();
  }, [refetch]);

  return (
    <section aria-labelledby="admin-analytics-heading" className="mb-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="admin-analytics-heading" className="text-lg font-medium text-text-primary">
          {localize('com_ui_admin_analytics_heading')}
        </h2>
        {/* Nothing to arrange while the analytics are loading, forbidden, erroring, or empty. */}
        {data != null && <Customize layout={layout} />}
      </div>
      <QueryState
        isLoading={isLoading}
        error={error}
        isEmpty={data != null && data.conversationCount === 0}
        emptyKey="com_ui_admin_analytics_empty"
        errorKey="com_ui_admin_analytics_error"
        onRetry={handleRetry}
      >
        {data != null && packed.length === 0 && (
          <p
            className="rounded-xl border border-border-light bg-surface-secondary px-4 py-10 text-center text-text-secondary"
            role="status"
          >
            {localize('com_ui_admin_panels_all_hidden')}
          </p>
        )}
        {data != null && packed.length > 0 && (
          <div className="grid gap-3 lg:grid-cols-5">
            {packed.map(({ panel, columns }) => {
              const definition = panelFor(panel.id);
              if (definition === undefined) {
                return null;
              }
              const { Component } = definition;
              return (
                <div key={panel.id} className={SPAN_CLASS[columns]}>
                  <Component data={data} params={params} />
                </div>
              );
            })}
          </div>
        )}
      </QueryState>
    </section>
  );
}
