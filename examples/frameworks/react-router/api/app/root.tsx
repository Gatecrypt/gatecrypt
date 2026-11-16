import { Outlet } from 'react-router';

// Every React Router app has a root route. This one has no pages of its own: the app is its
// resource route, app/routes/api.me.ts, and any other address is a 404.
export default function Root() {
  return <Outlet />;
}
