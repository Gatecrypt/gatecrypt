import { useEffect, useState } from 'react';
import type { Route } from './+types/home';

// Where this site's API is (../api). Read when the site is built: see vite.config.ts.
const API: string = import.meta.env.EXAMPLE_API_URL ?? 'http://localhost:3000';

export const meta: Route.MetaFunction = () => [{ title: 'React Router example' }];

export default function Home() {
  const [email, setEmail] = useState('…');

  useEffect(() => {
    // An ordinary fetch. The build named this address as the site's API (GATECRYPT_API, or --api),
    // so Gatecrypt's service worker adds the visitor's token and the API knows who is asking.
    fetch(`${API}/api/me`)
      .then(async (res) => {
        const body = await res.json();
        setEmail(res.ok ? body.email : `refused (${res.status} ${body.error})`);
      })
      .catch((error) => setEmail(`failed (${error})`));
  }, []);

  return (
    <>
      <h1>React Router example</h1>
      <p data-testid="secret">Internal only: GATECRYPT_EXAMPLE_MARKER (React Router)</p>
      <p>
        The API says you are <strong data-testid="api-email">{email}</strong>
      </p>
    </>
  );
}
