import type { Route } from './+types/about';

export const meta: Route.MetaFunction = () => [{ title: 'About' }];

// Reached by a link, by a reload, or as the first page someone opens: there is no about.html, and
// Gatecrypt's service worker answers with index.html, as a host set up for a single-page app would.
export default function About() {
  return (
    <>
      <h1>About</h1>
      <p data-testid="about">Also internal: GATECRYPT_EXAMPLE_MARKER (React Router, second page)</p>
    </>
  );
}
