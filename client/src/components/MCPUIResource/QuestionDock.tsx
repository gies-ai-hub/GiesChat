import { useMemo } from 'react';
import { useRecoilValue } from 'recoil';
import { UIResourceRenderer } from '@mcp-ui/client';
import { Constants, Tools } from 'librechat-data-provider';
import type { TMessage, UIResource } from 'librechat-data-provider';
import { useGetMessagesByConvoId } from '~/data-provider';
import { useChatContext } from '~/Providers';
import { handleUIAction, cn } from '~/utils';
import { useLocalize } from '~/hooks';
import store from '~/store';

export const QUESTION_CARD_PREFIX = 'ui://pptx/questions/';

/**
 * A question card is docked only while it belongs to the latest message —
 * answering it (or sending anything else) appends a newer message, which
 * un-docks the card without any extra state.
 */
export function findQuestionCard(messages?: TMessage[] | null): UIResource | undefined {
  const last = messages?.[messages.length - 1];
  if (!last?.attachments?.length) {
    return undefined;
  }
  for (const attachment of last.attachments) {
    if (attachment?.type !== Tools.ui_resources) {
      continue;
    }
    const resources = attachment[Tools.ui_resources];
    if (!Array.isArray(resources)) {
      continue;
    }
    for (let i = resources.length - 1; i >= 0; i--) {
      if (resources[i]?.uri?.startsWith(QUESTION_CARD_PREFIX)) {
        return resources[i];
      }
    }
  }
  return undefined;
}

/** Docks the active deck-question card above the composer instead of inline in the thread. */
export default function QuestionDock() {
  const localize = useLocalize();
  const { ask, conversation } = useChatContext();
  const conversationId = conversation?.conversationId;

  const maximizeChatSpace = useRecoilValue(store.maximizeChatSpace);

  const { data: messages } = useGetMessagesByConvoId(conversationId ?? '', {
    enabled: !!conversationId && conversationId !== Constants.SEARCH,
  });

  const card = useMemo(() => findQuestionCard(messages), [messages]);

  if (!card) {
    return null;
  }

  return (
    <div
      role="group"
      aria-label={localize('com_ui_deck_questions')}
      className={cn(
        'absolute bottom-full left-0 right-0 z-10 mx-auto mb-4 w-full transition-[max-width] duration-300 sm:px-2',
        maximizeChatSpace ? 'max-w-full' : 'md:max-w-3xl xl:max-w-4xl',
      )}
    >
      <UIResourceRenderer
        resource={card}
        onUIAction={async (result) => handleUIAction(result, ask)}
        htmlProps={{
          autoResizeIframe: { height: true },
          sandboxPermissions: 'allow-popups',
          style: { width: '100%' },
        }}
      />
    </div>
  );
}
