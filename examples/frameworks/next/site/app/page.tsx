import { ApiEmail } from './api-email';

// Where this site's API is (../api). Read when the site is built.
const api = process.env.EXAMPLE_API_URL ?? 'http://localhost:3001';

export default function Home() {
  return (
    <main>
      <h1>Next.js example</h1>
      <p data-testid="secret">Internal only: GATECRYPT_EXAMPLE_MARKER (Next.js)</p>
      <p>
        The API says you are <ApiEmail api={api} />
      </p>
    </main>
  );
}
