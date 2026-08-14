import { useLocation } from 'react-router-dom';
import ReportIssueDialog from '~/components/Chat/ReportIssueDialog';
import BackgroundToggle from './BackgroundToggle';

/** Global top-right controls for every non-chat page; chat's header renders its own pair. */
export default function TopRightControls() {
  const { pathname } = useLocation();

  if (pathname.startsWith('/c/')) {
    return null;
  }

  return (
    <div className="fixed right-3 top-2 z-30 hidden items-center gap-2 md:flex">
      <BackgroundToggle />
      <ReportIssueDialog />
    </div>
  );
}
