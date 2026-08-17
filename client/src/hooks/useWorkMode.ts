import { useCallback, useMemo } from 'react';
import { LocalStorageKeys } from 'librechat-data-provider';
import type { TModelSpec } from 'librechat-data-provider';
import { useGetStartupConfig, useGetEndpointsQuery } from '~/data-provider';
import useSelectMention from '~/hooks/Input/useSelectMention';
import useGetConversation from '~/hooks/Conversations/useGetConversation';
import useNewConvo from '~/hooks/useNewConvo';
import { useChatContext } from '~/Providers';

/** The deck builder, hidden from the model menu via `showInMenu: false` in librechat.yaml. */
export const WORK_MODE_SPEC = 'gieschat-deck-builder';
/** Its endpoint, which the client must name because the spec never reaches the browser. */
export const WORK_MODE_ENDPOINT = 'Azure OpenAI';

/**
 * Chat/Work mode for the chat header and landing.
 *
 * Work selects a spec the client cannot see: `showInMenu: false` strips it from the
 * startup config, so there is no spec object to hand to `onSelectSpec`. A synthetic
 * one carrying only the name and endpoint is enough — the server resolves the real
 * definition from its unfiltered list (`buildEndpointOption.js`) and attaches the
 * prompt, model, and MCP servers. Going through `onSelectSpec` rather than building
 * a conversation by hand is what preserves upstream's mid-conversation switch
 * behaviour, including keeping the thread.
 */
export default function useWorkMode() {
  const { conversation, index } = useChatContext();
  const { data: startupConfig } = useGetStartupConfig();
  const { data: endpointsConfig } = useGetEndpointsQuery();
  const getConversation = useGetConversation(index ?? 0);
  const { newConversation } = useNewConvo(index ?? 0);

  const { onSelectSpec } = useSelectMention({
    modelSpecs: startupConfig?.modelSpecs?.list ?? [],
    endpointsConfig: endpointsConfig ?? {},
    getConversation,
    newConversation,
    returnHandlers: true,
  });

  const isWork = conversation?.spec === WORK_MODE_SPEC;

  const specs = useMemo(() => startupConfig?.modelSpecs?.list ?? [], [startupConfig]);

  const selectWork = useCallback(() => {
    if (isWork) {
      return;
    }
    const current = conversation?.spec;
    if (typeof current === 'string' && current !== '') {
      localStorage.setItem(LocalStorageKeys.LAST_CHAT_SPEC, current);
    }
    onSelectSpec?.({
      name: WORK_MODE_SPEC,
      label: WORK_MODE_SPEC,
      preset: { endpoint: WORK_MODE_ENDPOINT },
    } as TModelSpec);
  }, [conversation?.spec, isWork, onSelectSpec]);

  const selectChat = useCallback(() => {
    if (!isWork) {
      return;
    }
    const remembered = localStorage.getItem(LocalStorageKeys.LAST_CHAT_SPEC) ?? '';
    const target =
      specs.find((spec) => spec.name === remembered) ??
      specs.find((spec) => spec.default === true) ??
      specs[0];
    if (target) {
      onSelectSpec?.(target);
    }
  }, [isWork, onSelectSpec, specs]);

  return { isWork, selectWork, selectChat };
}
