import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import ReportIssueDialog from '~/components/Chat/ReportIssueDialog';
import BackgroundToggle from './BackgroundToggle';

const ACTIONS_SLOT_ID = 'top-right-actions';

/**
 * Places page-specific buttons into the shared top-right cluster.
 *
 * The cluster is global and the actions are not, so pages hand theirs over
 * through a portal rather than the cluster learning about every page. Renders
 * nothing when the slot is absent — on the chat route, where the cluster steps
 * aside for the chat header's own controls.
 */
export function TopRightActions({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const { pathname } = useLocation();

  useEffect(() => {
    setSlot(document.getElementById(ACTIONS_SLOT_ID));
  }, [pathname]);

  if (!slot) {
    return null;
  }

  return createPortal(children, slot);
}

/** Global top-right controls for every non-chat page; chat's header renders its own pair. */
export default function TopRightControls() {
  const { pathname } = useLocation();

  if (pathname.startsWith('/c/')) {
    return null;
  }

  return (
    <div className="fixed right-3 top-2 z-30 hidden items-center gap-2 md:flex">
      <div id={ACTIONS_SLOT_ID} className="flex items-center gap-2" />
      <BackgroundToggle />
      <ReportIssueDialog />
    </div>
  );
}
