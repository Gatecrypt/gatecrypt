import { useEffect, useState } from 'react';
import logoUrl from '../logo.svg';
import { MARKER } from '../marker';

interface Notice {
  title: string;
  body: string;
}

export function Home() {
  const [notices, setNotices] = useState<Notice[] | null>(null);

  // A runtime fetch of a file from public/: also served decrypted by the service worker.
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}notices.json`)
      .then((res) => res.json())
      .then((data: { notices: Notice[] }) => setNotices(data.notices))
      .catch(() => setNotices([]));
  }, []);

  return (
    <>
      <h1>Welcome to the handbook</h1>
      <img src={logoUrl} alt="Acme logo" width="96" height="96" />
      <p data-testid="home-secret">Internal only: {MARKER} (main chunk)</p>
      <h2>Notices</h2>
      {notices === null ? (
        <p>Loading notices…</p>
      ) : (
        <ul data-testid="notices">
          {notices.map((notice) => (
            <li key={notice.title}>
              <strong>{notice.title}</strong>: {notice.body}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
