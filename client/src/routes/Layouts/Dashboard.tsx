import { Outlet } from 'react-router-dom';
import { TopRightControls } from '~/components/ui';
import { useAuthContext } from '~/hooks';

export default function DashboardRoute() {
  const { isAuthenticated } = useAuthContext();

  if (!isAuthenticated) {
    return null;
  }

  return (
    <>
      <TopRightControls />
      <Outlet />
    </>
  );
}
