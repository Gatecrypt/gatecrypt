'use client';

import { useEffect, useState } from 'react';

export function ApiEmail({ api }: { api: string }) {
  const [text, setText] = useState('…');

  useEffect(() => {
    // An ordinary fetch. The build named this address as the site's API (GATECRYPT_API, or --api),
    // so Gatecrypt's service worker adds the visitor's token and the API knows who is asking.
    fetch(`${api}/api/me`)
      .then(async (res) => {
        const body = await res.json();
        setText(res.ok ? body.email : `refused (${res.status} ${body.error})`);
      })
      .catch((error) => setText(`failed (${error})`));
  }, [api]);

  return <strong data-testid="api-email">{text}</strong>;
}
