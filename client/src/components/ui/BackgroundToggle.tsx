import React, { useContext } from 'react';
import { Moon, Sun } from 'lucide-react';
import { ThemeContext, isDark } from '@librechat/client';
import { cn } from '~/utils';

interface BackgroundToggleProps {
  /** Renders the short label ("White"/"Black") for tight headers. */
  compact?: boolean;
  /** Renders a sun/moon icon instead of a label (the public landing page). */
  icon?: boolean;
  className?: string;
}

export default function BackgroundToggle({
  compact = false,
  icon = false,
  className,
}: BackgroundToggleProps) {
  const { theme, setTheme } = useContext(ThemeContext);
  const isDarkTheme = isDark(theme);
  const label = isDarkTheme ? 'White background' : 'Black background';
  const shortLabel = isDarkTheme ? 'White' : 'Black';
  const Icon = isDarkTheme ? Sun : Moon;

  return (
    <button
      type="button"
      aria-label={`Switch to ${label}`}
      title={`Switch to ${label}`}
      onClick={() => setTheme(isDarkTheme ? 'light' : 'dark')}
      className={cn(
        'h-9 rounded-xl border px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--illini-orange)]',
        isDarkTheme
          ? 'border-white/40 bg-white text-black hover:bg-white/90'
          : 'border-black/20 bg-black text-white hover:bg-[var(--illini-blue)]',
        icon &&
          'grid w-9 place-items-center border-border-medium bg-transparent px-0 text-text-primary hover:border-[var(--illini-orange)] hover:bg-transparent hover:text-[var(--illini-orange)]',
        className,
      )}
    >
      {icon && <Icon className="size-4" aria-hidden="true" />}
      {!icon && (compact ? shortLabel : label)}
    </button>
  );
}
