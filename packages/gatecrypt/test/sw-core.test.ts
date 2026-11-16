import { describe, expect, it } from 'vitest';
import type { SiteIndex } from '../src/format.js';
import { isReserved, resolvePath, respond, wantsToken } from '../src/sw-core.js';

const entry = (b: string) => ({ b: `${b}.bin`, t: 'text/plain' });
const index: SiteIndex = {
  v: 1,
  files: {
    'index.html': entry('root'),
    'assets/app.js': entry('app'),
    'docs/index.html': entry('docs'),
    'about.html': entry('about'),
    'my file.txt': entry('space'),
  },
  fallback: 'index.html',
  passthrough: ['robots.txt'],
};

describe('isReserved', () => {
  it('covers the plaintext Gatecrypt files only', () => {
    expect(isReserved('gatecrypt.json')).toBe(true);
    expect(isReserved('gatecrypt-sw.js')).toBe(true);
    expect(isReserved('gatecrypt/abc.bin')).toBe(true);
    expect(isReserved('gatecrypt.jsonp')).toBe(false);
    expect(isReserved('index.html')).toBe(false);
    expect(isReserved('')).toBe(false);
  });
});

describe('resolvePath', () => {
  const file = (rel: string, nav = false) => {
    const r = resolvePath(index, rel, nav);
    return r.kind === 'file' ? r.path : r.kind;
  };
  it('finds exact files', () => {
    expect(file('assets/app.js')).toBe('assets/app.js');
  });
  it('decodes percent-encoding', () => {
    expect(file('my%20file.txt')).toBe('my file.txt');
    expect(file('%E0%A4%A')).toBe('network');
  });
  it('serves directory indexes', () => {
    expect(file('', true)).toBe('index.html');
    expect(file('docs/', true)).toBe('docs/index.html');
  });
  it('redirects a directory without its slash, for navigations', () => {
    expect(resolvePath(index, 'docs', true)).toEqual({ kind: 'redirect', to: 'docs/' });
    expect(file('docs')).toBe('network');
  });
  it('serves extensionless .html pages', () => {
    expect(file('about', true)).toBe('about.html');
  });
  it('falls back to the app shell for unknown navigations only', () => {
    expect(file('reports/2024', true)).toBe('index.html');
    expect(file('reports/2024', false)).toBe('network');
    expect(file('assets/missing.js', false)).toBe('network');
  });
  it('leaves passthrough files to the network even for navigations', () => {
    expect(file('robots.txt', true)).toBe('network');
  });
  it('has no fallback when the index has none', () => {
    expect(resolvePath({ ...index, fallback: null }, 'nope', true)).toEqual({ kind: 'network' });
  });
  it('is not fooled by Object.prototype names', () => {
    expect(file('constructor')).toBe('network');
    expect(file('__proto__')).toBe('network');
    expect(file('toString', true)).toBe('index.html');
  });
});

describe('respond', () => {
  const body = new TextEncoder().encode('0123456789').buffer;
  const get = (range?: string) =>
    respond(new Request('https://x.test/f', range ? { headers: { range } } : {}), body, 'text/plain');

  it('returns the whole file with its content type', async () => {
    const res = get();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await res.text()).toBe('0123456789');
  });
  it.each([
    ['bytes=2-5', '2345', 'bytes 2-5/10'],
    ['bytes=7-', '789', 'bytes 7-9/10'],
    ['bytes=-3', '789', 'bytes 7-9/10'],
    ['bytes=0-999', '0123456789', 'bytes 0-9/10'],
    ['bytes=-999', '0123456789', 'bytes 0-9/10'],
  ])('answers %s', async (range, text, contentRange) => {
    const res = get(range);
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(contentRange);
    expect(await res.text()).toBe(text);
  });
  it('answers an unsatisfiable range with 416', () => {
    const res = get('bytes=20-30');
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe('bytes */10');
  });
  it('ignores range forms it does not support', async () => {
    expect(get('bytes=0-1,3-4').status).toBe(200);
    expect(get('bytes=-').status).toBe(200);
    expect(get('items=0-1').status).toBe(200);
  });
});

describe('wantsToken', () => {
  const SITE = 'https://docs.example.com';
  const wants = (api: string[] | undefined, url: string) => wantsToken(api, new URL(url), SITE);

  it('is for nothing when the build named no API', () => {
    expect(wants(undefined, 'https://api.example.com/me')).toBe(false);
    expect(wants([], 'https://api.example.com/me')).toBe(false);
  });

  it('matches everything at an address', () => {
    const api = ['https://api.example.com'];
    expect(wants(api, 'https://api.example.com/')).toBe(true);
    expect(wants(api, 'https://api.example.com/v1/me?full=1')).toBe(true);
  });

  it('never matches another host, port or scheme, however alike', () => {
    const api = ['https://api.example.com'];
    expect(wants(api, 'https://api.example.com.evil.test/me')).toBe(false);
    expect(wants(api, 'https://evil.test/https://api.example.com/')).toBe(false);
    expect(wants(api, 'https://api.example.com:8443/me')).toBe(false);
    expect(wants(api, 'http://api.example.com/me')).toBe(false);
    expect(wants(api, 'https://sub.api.example.com/me')).toBe(false);
    expect(wants(api, `${SITE}/me`)).toBe(false);
  });

  it('matches a path and what is under it, not names that start the same', () => {
    for (const api of [['https://api.example.com/v1'], ['https://api.example.com/v1/']]) {
      expect(wants(api, 'https://api.example.com/v1')).toBe(true);
      expect(wants(api, 'https://api.example.com/v1/me')).toBe(true);
      expect(wants(api, 'https://api.example.com/v1?x=1')).toBe(true);
      expect(wants(api, 'https://api.example.com/v10/me')).toBe(false);
      expect(wants(api, 'https://api.example.com/')).toBe(false);
      expect(wants(api, 'https://api.example.com/other/v1/me')).toBe(false);
    }
  });

  it("takes a bare path as one on the site's own origin", () => {
    expect(wants(['/api'], `${SITE}/api/me`)).toBe(true);
    expect(wants(['/api'], `${SITE}/apiary`)).toBe(false);
    expect(wants(['/api'], 'https://elsewhere.example/api/me')).toBe(false);
  });

  it('matches any of several, and ignores an entry that is not an address', () => {
    const api = ['https://[', '/api', 'https://api.example.com'];
    expect(wants(api, `${SITE}/api`)).toBe(true);
    expect(wants(api, 'https://api.example.com/x')).toBe(true);
    expect(wants(api, 'https://other.example.com/x')).toBe(false);
  });
});
