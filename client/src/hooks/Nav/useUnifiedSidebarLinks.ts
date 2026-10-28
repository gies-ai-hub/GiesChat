import { useMemo } from 'react';
import { useRecoilValue } from 'recoil';
import { Bot, GraduationCap, Lightbulb, MessagesSquare } from 'lucide-react';
import { useUserKeyQuery } from 'librechat-data-provider/react-query';
import { EModelEndpoint, getConfigDefaults, getEndpointField } from 'librechat-data-provider';
import type { TEndpointsConfig } from 'librechat-data-provider';
import type { NavLink } from '~/common';
import BrainstormPanel from '~/components/Brainstorm/BrainstormPanel';
import ConversationsSection from '~/components/UnifiedSidebar/ConversationsSection';
import { useGetEndpointsQuery, useGetStartupConfig } from '~/data-provider';
import useSideNavLinks from '~/hooks/Nav/useSideNavLinks';
import { useAuthContext, useShowMarketplace } from '~/hooks';
import store from '~/store';

const defaultInterface = getConfigDefaults().interface;

/** The Agents (marketplace) sidebar link is switched off for now (2026-10-24). Flip to `true` to restore it; `/agents` itself stays reachable. */
const AGENTS_LINK_ENABLED = false;

export default function useUnifiedSidebarLinks() {
  const conversation = useRecoilValue(store.conversationByIndex(0));
  const endpoint = conversation?.endpoint;
  const { data: startupConfig } = useGetStartupConfig();
  const { data: endpointsConfig = {} as TEndpointsConfig } = useGetEndpointsQuery();

  const interfaceConfig = useMemo(
    () => startupConfig?.interface ?? defaultInterface,
    [startupConfig],
  );

  const endpointType = useMemo(
    () => getEndpointField(endpointsConfig, endpoint, 'type'),
    [endpoint, endpointsConfig],
  );

  const userProvidesKey = useMemo(
    () => !!(endpointsConfig?.[endpoint ?? '']?.userProvide ?? false),
    [endpointsConfig, endpoint],
  );

  const { data: keyExpiry = { expiresAt: undefined } } = useUserKeyQuery(endpoint ?? '');

  const keyProvided = useMemo(
    () => (userProvidesKey ? !!(keyExpiry.expiresAt ?? '') : true),
    [keyExpiry.expiresAt, userProvidesKey],
  );

  const sideNavLinks = useSideNavLinks({
    keyProvided,
    endpoint,
    endpointType,
    interfaceConfig,
    endpointsConfig,
    includeHidePanel: false,
  });

  const brainstormEnabled = startupConfig?.brainstormRoomsEnabled === true;
  const showAgentMarketplace = useShowMarketplace();
  /** The Agent dashboard is open to every signed-in user (2026-10-28). */
  const { user } = useAuthContext();
  const signedIn = user != null;

  const links = useMemo(() => {
    const conversationLink: NavLink = {
      title: 'com_ui_chat_history',
      label: '',
      icon: MessagesSquare,
      id: 'conversations',
      Component: ConversationsSection,
    };
    const brainstormLink: NavLink | null = brainstormEnabled
      ? {
          title: 'com_ui_rooms',
          label: '',
          icon: Lightbulb,
          id: 'brainstorm',
          Component: BrainstormPanel,
        }
      : null;
    const agentsLink: NavLink | null =
      AGENTS_LINK_ENABLED && showAgentMarketplace
        ? {
            title: 'com_ui_agents',
            label: '',
            icon: Bot,
            id: 'agents-home',
            href: '/agents',
          }
        : null;
    const adminLink: NavLink | null = signedIn
      ? {
          title: 'com_ui_admin_dashboard',
          label: '',
          icon: GraduationCap,
          id: 'admin-dashboard',
          href: '/admin',
        }
      : null;
    const panelLinks = sideNavLinks.filter((link) => link.id !== EModelEndpoint.agents);

    return [
      conversationLink,
      ...(brainstormLink ? [brainstormLink] : []),
      ...(agentsLink ? [agentsLink] : []),
      ...(adminLink ? [adminLink] : []),
      ...panelLinks,
    ];
  }, [sideNavLinks, brainstormEnabled, showAgentMarketplace, signedIn]);

  return links;
}
