import { getVisitorToken } from 'gatecrypt/client';
import { useEffect, useState } from 'react';

/** The site's own API (examples/apis/node). Set when the site is built; empty means there is none. */
const API = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

interface Me {
  email: string;
  origin: string;
  expiresAt: number;
}

async function answer(res: Response): Promise<string> {
  const body = (await res.json()) as Partial<Me> & { error?: string };
  return res.ok && body.email ? body.email : `refused (${res.status} ${body.error ?? ''})`;
}

export function Account() {
  const [seen, setSeen] = useState<string>();
  const [manual, setManual] = useState<string>();

  // An ordinary fetch. The service worker knows this address is the site's API (the `api` build
  // option) and adds the visitor's token, so the API knows who is asking.
  const ask = (): void => {
    setSeen(undefined);
    fetch(`${API}/api/me`)
      .then(answer)
      .then(setSeen, (error: unknown) => setSeen(`failed (${String(error)})`));
  };
  useEffect(() => {
    if (API) ask();
  }, []);

  // The same, by hand: for an API that was not named in the build, or a request made some other way.
  const askByHand = async (): Promise<void> => {
    try {
      const token = await getVisitorToken();
      setManual(await answer(await fetch(`${API}/api/me`, { headers: { Authorization: `Bearer ${token}` } })));
    } catch (error) {
      setManual(`failed (${String(error)})`);
    }
  };

  if (!API) return <p data-testid="no-api">This build was not given an API to call.</p>;
  return (
    <>
      <h1>Account</h1>
      <p>
        The API says you are <strong data-testid="api-email">{seen ?? '…'}</strong>
      </p>
      <p>
        <button type="button" onClick={ask}>
          Ask again
        </button>{' '}
        <button type="button" onClick={() => void askByHand()}>
          Ask with getVisitorToken()
        </button>{' '}
        {manual && <span data-testid="api-manual">{manual}</span>}
      </p>
    </>
  );
}
