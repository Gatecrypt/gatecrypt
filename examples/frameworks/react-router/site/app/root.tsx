import type { ReactNode } from 'react';
import { Link, Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router';

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width" />
        <Meta />
        <Links />
      </head>
      <body>
        <nav>
          <Link to="/">Home</Link> <Link to="/about">About</Link>
        </nav>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

// What index.html holds until the scripts have loaded. It is encrypted like everything else.
export function HydrateFallback() {
  return <p>Loading…</p>;
}

export default function Root() {
  return <Outlet />;
}
