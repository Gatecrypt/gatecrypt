/**
 * A plain static file server that behaves like GitHub Pages: no rewrites,
 * directory indexes, and 404.html (with status 404) for anything missing.
 * Used by `pnpm dev` and the end-to-end tests to host the encrypted demo.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

const isFile = async (file) => (await stat(file).catch(() => null))?.isFile() ?? false;

/**
 * @param {{ dir: string, port: number, mount?: string, spa?: boolean, redirectIndex?: boolean }} options
 *   `mount` serves the directory under a path prefix such as "/handbook/", like a GitHub Pages project site.
 *   `spa` answers unknown paths with index.html (status 200), for single-page apps such as the dashboard.
 *   `redirectIndex` redirects ".../index.html" to its directory, as Cloudflare and Netlify do.
 * @returns {Promise<{ url: string, close: () => Promise<void> }>}
 */
export async function serveStatic({ dir, port, mount = '/', spa = false, redirectIndex = false }) {
  const root = path.resolve(dir);
  const server = createServer(async (req, res) => {
    const send = (status, file) => {
      res.writeHead(status, {
        'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
        // GitHub Pages caches everything for ten minutes; do the same so stale-cache bugs show up here.
        'cache-control': 'max-age=600',
      });
      createReadStream(file).pipe(res);
    };
    try {
      let pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
      if (!pathname.startsWith(mount)) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        return res.end('Not found');
      }
      pathname = pathname.slice(mount.length);
      if (redirectIndex && /(^|\/)index\.html$/.test(pathname)) {
        res.writeHead(307, { location: mount + pathname.slice(0, -'index.html'.length) });
        return res.end();
      }
      let file = path.join(root, pathname);
      if (file !== root && !file.startsWith(root + path.sep)) throw new Error('outside root');
      if (pathname === '' || pathname.endsWith('/')) file = path.join(file, 'index.html');
      if (await isFile(file)) return send(200, file);
      if (spa) return send(200, path.join(root, 'index.html'));
      const notFound = path.join(root, '404.html');
      if (await isFile(notFound)) return send(404, notFound);
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found');
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain' });
      res.end('Bad request');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, 'localhost', resolve);
  });
  return {
    url: `http://localhost:${port}${mount}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
