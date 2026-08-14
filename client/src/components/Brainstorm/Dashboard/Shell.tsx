import { NavLink } from 'react-router-dom';
import { LayoutGrid, MessagesSquare, SquarePlus, Undo2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useAuthContext, useLocalize } from '~/hooks';
import { cn } from '~/utils';

export const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();

function RailLink({
  to,
  end,
  icon: Icon,
  label,
}: {
  to: string;
  end?: boolean;
  icon: LucideIcon;
  label: string;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-[9px] border-l-[3px] px-3 py-2.5 text-sm font-medium transition-colors duration-150',
          isActive
            ? 'border-transparent bg-surface-active text-text-primary'
            : 'border-transparent text-text-secondary hover:bg-surface-hover hover:text-text-primary',
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon
            className={cn('size-[18px]', isActive ? 'text-text-primary' : 'text-text-secondary')}
            aria-hidden={true}
          />
          {label}
        </>
      )}
    </NavLink>
  );
}

function MobileLink({
  to,
  end,
  icon: Icon,
  label,
}: {
  to: string;
  end?: boolean;
  icon: LucideIcon;
  label: string;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      title={label}
      aria-label={label}
      className={({ isActive }) =>
        cn(
          'flex size-9 items-center justify-center rounded-lg transition-colors',
          isActive
            ? 'bg-surface-active text-text-primary'
            : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary',
        )
      }
    >
      <Icon className="size-4" aria-hidden={true} />
    </NavLink>
  );
}

export default function Shell({ title, children }: { title: string; children: ReactNode }) {
  const localize = useLocalize();
  const { user, logout } = useAuthContext();
  const name = user?.name ?? user?.username ?? '';

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-surface-secondary-alt text-text-primary">
      <aside className="hidden w-[248px] shrink-0 flex-col border-r border-border-light bg-surface-primary px-4 py-[22px] text-text-primary md:flex">
        <div className="flex items-center gap-2.5 px-2 pb-[22px] pt-1">
          <span className="flex size-[30px] items-center justify-center rounded-lg bg-surface-tertiary text-text-secondary">
            <MessagesSquare className="size-4" aria-hidden="true" />
          </span>
          <span className="text-[19px] font-bold tracking-[-0.02em]">
            {localize('com_ui_brainstorm')}
          </span>
        </div>
        <div className="px-2.5 pb-1.5 pt-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-secondary">
          {localize('com_ui_brainstorm_workspace')}
        </div>
        <nav className="grid gap-1" aria-label={localize('com_ui_brainstorm_workspace')}>
          <RailLink
            to="/brainstorm"
            end={true}
            icon={LayoutGrid}
            label={localize('com_ui_brainstorm_overview')}
          />
          <RailLink
            to="/brainstorm/new"
            icon={SquarePlus}
            label={localize('com_ui_brainstorm_create_room')}
          />
          <RailLink to="/c/new" icon={Undo2} label={localize('com_ui_brainstorm_back_to_chat')} />
        </nav>
        <div className="mt-auto pt-[18px]">
          <div className="mb-2.5 flex items-center gap-2.5 rounded-[10px] bg-surface-tertiary p-2.5">
            <span className="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-surface-primary text-[13px] font-bold text-text-primary">
              {initialsOf(name)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-semibold">{name}</span>
              <span className="block truncate text-[11px] text-text-secondary">
                {user?.email ?? ''}
              </span>
            </span>
          </div>
          <button
            type="button"
            onClick={() => logout()}
            className="w-full rounded-[9px] border border-border-light bg-surface-primary py-[9px] text-[13px] font-semibold text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
          >
            {localize('com_nav_log_out')}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-border-light bg-surface-primary px-4 py-4 sm:px-7">
          <h1 className="text-lg font-bold text-text-primary">{title}</h1>
          <div className="flex items-center gap-3.5 md:pr-[13.5rem]">
            {name !== '' && (
              <span className="hidden text-[13px] text-text-secondary md:block">
                {localize('com_ui_brainstorm_welcome_back', { name })}
              </span>
            )}
            <span
              className="hidden size-9 items-center justify-center rounded-full bg-surface-tertiary text-sm font-bold text-text-primary md:flex"
              aria-hidden="true"
            >
              {initialsOf(name)}
            </span>
            <nav
              className="flex items-center gap-1 md:hidden"
              aria-label={localize('com_ui_brainstorm_workspace')}
            >
              <MobileLink
                to="/brainstorm"
                end={true}
                icon={LayoutGrid}
                label={localize('com_ui_brainstorm_overview')}
              />
              <MobileLink
                to="/brainstorm/new"
                icon={SquarePlus}
                label={localize('com_ui_brainstorm_create_room')}
              />
              <MobileLink
                to="/c/new"
                icon={Undo2}
                label={localize('com_ui_brainstorm_back_to_chat')}
              />
            </nav>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-7">{children}</div>
        </main>
      </div>
    </div>
  );
}
