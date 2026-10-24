import { Constants } from 'librechat-data-provider';
import { useGetConvoIdQuery } from '~/data-provider';
import { useLocalize } from '~/hooks';

/** Tells the student this chat began on a course site, and that it is theirs to keep or delete. */
export default function ApiSourceBanner({ conversationId }: { conversationId?: string }) {
  const localize = useLocalize();
  const enabled = conversationId != null && conversationId !== Constants.NEW_CONVO;
  const { data } = useGetConvoIdQuery(conversationId ?? '', { enabled });
  const name = enabled ? data?.apiKeyName : undefined;
  if (!name) {
    return null;
  }
  return (
    <div
      role="note"
      className="mx-auto mt-2 w-full max-w-3xl rounded-lg border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-secondary"
    >
      {localize('com_ui_api_started_on', { name })}
    </div>
  );
}
