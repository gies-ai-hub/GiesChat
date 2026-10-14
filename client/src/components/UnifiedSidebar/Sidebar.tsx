import { memo } from 'react';
import type { NavLink } from '~/common';
import SidePanelNav from '~/components/SidePanel/Nav';
import ExpandedPanel from './ExpandedPanel';
import { cn } from '~/utils';

function Sidebar({
  links,
  expanded,
  onCollapse,
  onExpand,
  onResizeStart,
  onResizeKeyboard,
  width,
  minWidth,
}: {
  links: NavLink[];
  expanded: boolean;
  onCollapse: () => void;
  onExpand: () => void;
  onResizeStart: (e: React.MouseEvent) => void;
  onResizeKeyboard: (direction: 'shrink' | 'grow') => void;
  width: number;
  minWidth: number;
}) {
  return (
    <>
      <div className="flex h-full w-full overflow-hidden">
        <ExpandedPanel
          links={links}
          expanded={expanded}
          onCollapse={onCollapse}
          onExpand={onExpand}
        />
        <nav
          className={cn(
            'min-h-0 flex-1 overflow-hidden bg-surface-primary-alt',
            expanded ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
          style={{ transition: expanded ? 'opacity 200ms ease 80ms' : 'opacity 150ms ease' }}
          aria-hidden={!expanded}
        >
          <SidePanelNav links={links} />
        </nav>
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuenow={Math.round(width)}
        aria-valuemin={minWidth}
        aria-valuemax={Math.round(window.innerWidth * 0.4)}
        tabIndex={expanded ? 0 : -1}
        className={cn(
          'group absolute right-0 top-0 z-10 flex h-full w-2 cursor-col-resize items-center justify-center transition-colors hover:bg-[#FF5F05] focus-visible:bg-[#FF5F05] focus-visible:outline-none active:bg-[#FF5F05]',
          expanded ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        style={{ transition: expanded ? 'opacity 200ms ease 80ms' : 'opacity 150ms ease' }}
        onMouseDown={onResizeStart}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') {
            onResizeKeyboard('shrink');
          } else if (e.key === 'ArrowRight') {
            onResizeKeyboard('grow');
          }
        }}
      >
        <div className="h-8 w-1 rounded-full bg-border-heavy group-hover:bg-white group-active:bg-white" />
      </div>
    </>
  );
}

export default memo(Sidebar);
