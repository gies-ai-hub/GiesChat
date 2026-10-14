import type t from 'librechat-data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

type AgentContactProps = {
  agent?: Pick<t.Agent, 'support_contact' | 'owner_contact'> | null;
  className?: string;
  /** False inside a card that is itself a button: a nested link breaks WCAG 4.1.2. */
  linked?: boolean;
};

export default function AgentContact({ agent, className = '', linked = true }: AgentContactProps) {
  const localize = useLocalize();
  const supportName = agent?.support_contact?.name?.trim() ?? '';
  const supportEmail = agent?.support_contact?.email?.trim() ?? '';
  const ownerName = agent?.owner_contact?.name?.trim() ?? '';
  const ownerEmail = agent?.owner_contact?.email?.trim() ?? '';
  let contact: { name: string; email: string } | null = null;
  if (supportName || supportEmail) {
    contact = { name: supportName, email: supportEmail };
  } else if (ownerName || ownerEmail) {
    contact = { name: ownerName, email: ownerEmail };
  }

  const label = contact?.name || contact?.email || localize('com_agents_no_contact_available');

  return (
    <div className={cn('flex min-w-0 items-center gap-1 text-text-secondary', className)}>
      <span className="shrink-0">{localize('com_agents_contact')}:</span>
      <span className="min-w-0 truncate">
        {linked && contact?.email ? (
          <a href={`mailto:${contact.email}`} className="text-primary hover:underline">
            {label}
          </a>
        ) : (
          label
        )}
      </span>
    </div>
  );
}
