import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { b64urlDecode, decryptBlob, importKey, indexAad, parseManifest, type SiteIndex } from '../src/format.js';

export async function makeSite(files: Record<string, string | Uint8Array>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'gatecrypt-test-'));
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await writeFile(path.join(dir, name), content);
  }
  return dir;
}

/** Every file under dir, as relative path -> bytes. */
export async function readTree(dir: string): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath, entry.name);
    out.set(path.relative(dir, full).split(path.sep).join('/'), await readFile(full));
  }
  return out;
}

/** The index of an encrypted site, opened with the key its build registered. */
export async function readIndex(tree: Map<string, Buffer>, rawKey: string): Promise<SiteIndex> {
  const manifest = parseManifest(JSON.parse(tree.get('gatecrypt.json')!.toString()));
  const key = await importKey(b64urlDecode(rawKey), ['decrypt']);
  const plain = await decryptBlob(key, new Uint8Array(tree.get(manifest.index)!), indexAad(manifest.keyId));
  return JSON.parse(Buffer.from(plain).toString()) as SiteIndex;
}

export interface FakeService {
  url: string;
  requests: {
    method: string;
    path: string;
    authorization: string | undefined;
    userAgent: string | undefined;
    body: { keyId: string; key: string; version: string };
  }[];
  /** Status codes to answer with, in order; 201 once exhausted. */
  statuses: number[];
  /** What the service says about the project on success. */
  project: { name?: string; origins?: string[] };
  close: () => Promise<void>;
}

/** Stands in for the endpoints a build calls: key registration and the check. */
export async function fakeService(): Promise<FakeService> {
  const service: FakeService = {
    url: '',
    requests: [],
    statuses: [],
    project: { name: 'Fixture', origins: ['https://fixture.example'] },
    close: async () => {},
  };
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      service.requests.push({
        method: req.method!,
        path: req.url!,
        authorization: req.headers.authorization,
        userAgent: req.headers['user-agent'],
        body: raw ? JSON.parse(raw) : undefined,
      });
      const status = service.statuses.shift() ?? (req.method === 'GET' ? 200 : 201);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(status < 300 ? { ok: true, ...service.project } : { error: 'test_error' }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  service.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  service.close = () => new Promise((resolve) => server.close(() => resolve()));
  return service;
}

/** Runs `work` with environment variables set (or, for undefined, unset), then puts them back. */
export async function withEnv<T>(values: Record<string, string | undefined>, work: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
  const apply = (from: Record<string, string | undefined>): void => {
    for (const [name, value] of Object.entries(from)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
  apply(values);
  try {
    return await work();
  } finally {
    apply(saved);
  }
}
