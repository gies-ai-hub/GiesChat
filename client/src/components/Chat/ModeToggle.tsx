import useWorkMode from '~/hooks/useWorkMode';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const pill =
  'rounded-full px-6 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--illini-orange)]';

/** Chat / Work mode pills. Work is the deck builder, which is absent from the model menu. */
export default function ModeToggle({ className }: { className?: string }) {
  const localize = useLocalize();
  const { isWork, selectWork, selectChat } = useWorkMode();

  return (
    <div
      role="tablist"
      aria-label={localize('com_ui_mode')}
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-surface-secondary p-1',
        className,
      )}
    >
      <button
        type="button"
        role="tab"
        aria-selected={!isWork}
        onClick={selectChat}
        className={cn(
          pill,
          isWork ? 'text-text-secondary' : 'bg-surface-tertiary text-text-primary',
        )}
      >
        {localize('com_ui_mode_chat')}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={isWork}
        onClick={selectWork}
        className={cn(
          pill,
          isWork ? 'bg-[var(--illini-orange)] text-white' : 'text-text-secondary',
        )}
      >
        {localize('com_ui_mode_work')}
      </button>
    </div>
  );
}
