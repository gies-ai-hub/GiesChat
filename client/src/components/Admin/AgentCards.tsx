import React, { useMemo } from 'react';
import type { AdminAgentUsage } from 'librechat-data-provider';
import type { AgentActionHandlers } from './AgentActions';
import { useAgentCategories, useLocalize, TranslationKeys } from '~/hooks';
import { useAdminAgentUsageQuery } from '~/data-provider';
import { cn, renderAgentAvatar } from '~/utils';
import AgentActions from './AgentActions';

interface AgentCardsProps extends AgentActionHandlers {
  groupId: string;
  days: number;
  selectedAgentId: string | null;
  /** The agent whose drafts row is open in the table below. */
  expandedId: string | null;
  onSelectAgent: (agent: AdminAgentUsage) => void;
}

export default function AgentCards({
  groupId,
  days,
  selectedAgentId,
  expandedId,
  onSelectAgent,
  ...actions
}: AgentCardsProps) {
  const localize = useLocalize();
  const { categories } = useAgentCategories();
  const params = { days, ...(groupId ? { groupId } : {}) };
  const { data } = useAdminAgentUsageQuery(params);

  const labelByCategory = useMemo(
    () => new Map(categories.map((category) => [category.value, category.label])),
    [categories],
  );

  /** Seeded categories carry a translation key as their label; user-made ones carry text. */
  const resolveCategoryLabel = (category: string | null): string => {
    if (category == null || category === '') {
      return '';
    }
    const label = labelByCategory.get(category);
    if (label == null) {
      return category.charAt(0).toUpperCase() + category.slice(1);
    }
    return label.startsWith('com_') ? localize(label as TranslationKeys) : label;
  };

  const agents = data?.agents ?? [];
  if (agents.length === 0) {
    return null;
  }

  return (
    <ul
      aria-label={localize('com_ui_admin_agents_grid_label')}
      className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
    >
      {agents.map((agent) => {
        const isSelected = agent.agent_id === selectedAgentId;
        const categoryLabel = resolveCategoryLabel(agent.category);
        return (
          <li key={agent.agent_id} className="group">
            <div
              className={cn(
                'relative flex h-full w-full flex-col rounded-xl px-4 py-3',
                'bg-surface-tertiary transition-colors duration-150 group-hover:bg-surface-hover',
                isSelected && 'bg-surface-hover ring-2 ring-border-heavy',
              )}
            >
              {categoryLabel !== '' && (
                <span className="absolute right-3 top-2 rounded-md bg-surface-hover px-2 py-0.5 text-xs text-text-secondary">
                  {categoryLabel}
                </span>
              )}
              <span className="flex flex-1 gap-4">
                <span className="flex-shrink-0 self-center">
                  {renderAgentAvatar(agent, { size: 'sm', showBorder: false })}
                </span>
                <span className="flex min-w-0 flex-1 flex-col justify-center">
                  {/* Its ::after covers the whole card, so a click anywhere still opens the agent. */}
                  <button
                    type="button"
                    aria-current={isSelected ? 'true' : undefined}
                    aria-describedby={`agent-card-${agent.agent_id}`}
                    onClick={() => onSelectAgent(agent)}
                    className={cn(
                      'pr-14 text-left font-semibold text-text-primary',
                      "after:absolute after:inset-0 after:rounded-xl after:content-['']",
                      'focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-border-heavy',
                    )}
                  >
                    <span className="line-clamp-2">{agent.name}</span>
                  </button>
                  <span id={`agent-card-${agent.agent_id}`} className="flex flex-col">
                    {agent.description != null && agent.description !== '' && (
                      <span className="mt-0.5 line-clamp-2 text-sm leading-snug text-text-secondary">
                        {agent.description}
                      </span>
                    )}
                    <span className="mt-1 text-xs tabular-nums text-text-secondary">
                      {agent.course == null || agent.course === ''
                        ? localize('com_ui_admin_card_stats', {
                            convos: agent.conversationCount,
                            students: agent.userCount,
                          })
                        : localize('com_ui_admin_card_stats_course', {
                            course: agent.course,
                            convos: agent.conversationCount,
                            students: agent.userCount,
                          })}
                    </span>
                  </span>
                </span>
              </span>
              {/* Shown on hover or keyboard focus, and always where there is no hover (touch). */}
              <AgentActions
                agent={agent}
                draftsExpanded={expandedId === agent.agent_id}
                className="relative z-10 mt-1 flex-wrap opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                {...actions}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
