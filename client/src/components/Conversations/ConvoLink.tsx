import React from 'react';
import { cn } from '~/utils';

interface ConvoLinkProps {
  isActiveConvo: boolean;
  isPopoverActive: boolean;
  title: string | null;
  onRename: () => void;
  isSmallScreen: boolean;
  localize: (key: any, options?: any) => string;
  children: React.ReactNode;
  /** Short visible label after the title, e.g. "via BADM 350 site". */
  tag?: string;
}

const ConvoLink: React.FC<ConvoLinkProps> = ({
  isActiveConvo,
  isPopoverActive,
  title,
  onRename,
  isSmallScreen,
  localize,
  children,
  tag,
}) => {
  return (
    <div
      className={cn(
        'flex min-w-0 grow items-center gap-2 overflow-hidden rounded-lg px-2',
        isActiveConvo || isPopoverActive ? 'bg-surface-active-alt' : '',
      )}
      title={title ?? undefined}
      aria-current={isActiveConvo ? 'page' : undefined}
      style={{ width: '100%' }}
    >
      {children}
      <div
        className="relative flex-1 grow overflow-hidden whitespace-nowrap"
        style={{ textOverflow: 'clip' }}
        onDoubleClick={(e) => {
          if (isSmallScreen) {
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          onRename();
        }}
        aria-label={title || localize('com_ui_untitled')}
      >
        {title || localize('com_ui_untitled')}
        <div
          className={cn(
            'pointer-events-none absolute bottom-0 right-0 top-0 w-20 bg-gradient-to-l',
            isActiveConvo || isPopoverActive
              ? 'from-surface-active-alt'
              : 'from-surface-primary-alt from-0% to-transparent group-hover:from-surface-active-alt group-hover:from-0%',
          )}
          aria-hidden="true"
        />
      </div>
      {tag != null && (
        <span className="max-w-[45%] shrink-0 truncate rounded border border-border-light px-1 text-[11px] leading-4 text-text-secondary">
          {tag}
        </span>
      )}
    </div>
  );
};

export default ConvoLink;
