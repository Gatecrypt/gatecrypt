import { API } from './format.js';
import { VERSION } from './version.js';

export interface RegisterKeyOptions {
  serviceUrl: string;
  projectId: string;
  deployToken: string;
  keyId: string;
  /** base64url of the 32 raw key bytes. */
  key: string;
  /** Attempts for network errors and 5xx responses. Registration is idempotent per keyId. */
  attempts?: number;
  retryDelayMs?: number;
}

/** What the service tells a build about its project. */
export interface ProjectInfo {
  /** The project's name in the dashboard. */
  name?: string;
  /** The site addresses (origins) visitors may sign in from. */
  origins?: string[];
}

interface CallOptions {
  serviceUrl: string;
  projectId: string;
  deployToken: string;
  attempts?: number;
  retryDelayMs?: number;
}

/**
 * One authenticated call from a build to the service, retried on network
 * errors and 5xx answers. Throws with a message fit for a build log.
 */
async function call(what: string, method: 'GET' | 'POST', path: string, options: CallOptions, body?: unknown): Promise<ProjectInfo> {
  const { serviceUrl, attempts = 3, retryDelayMs = 1000 } = options;
  const url = `${serviceUrl}${API}/projects/${encodeURIComponent(options.projectId)}${path}`;
  let failure = '';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt - 1)));
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${options.deployToken}`,
          'user-agent': `gatecrypt/${VERSION}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      failure = `could not reach ${serviceUrl} (${error instanceof Error ? error.message : String(error)})`;
      continue;
    }
    const answer = (await res.json().catch(() => undefined)) as (ProjectInfo & { error?: string }) | undefined;
    if (res.ok) {
      return {
        name: typeof answer?.name === 'string' ? answer.name : undefined,
        origins: Array.isArray(answer?.origins) ? answer.origins.filter((origin) => typeof origin === 'string') : undefined,
      };
    }
    failure = `${serviceUrl} answered ${res.status}${answer?.error ? ` (${answer.error})` : ''}`;
    if (res.status === 401) failure += '. Check the deploy token and that it belongs to this project';
    if (res.status === 404) failure += '. Check that the service address is right and that this version of gatecrypt is one it supports';
    if (res.status < 500) break;
  }
  throw new Error(`Gatecrypt: could not ${what}: ${failure}`);
}

/** Registers a build's key with the service. Throws with a message fit for a build log. */
export const registerKey = (options: RegisterKeyOptions): Promise<ProjectInfo> =>
  call('register the build key', 'POST', '/keys', options, { keyId: options.keyId, key: options.key, version: VERSION });

/** Asks the service whether a deploy token works for a project, without registering anything. */
export const checkProject = (options: CallOptions): Promise<ProjectInfo> =>
  call('check the project', 'GET', '/check', options);

/** Normalizes the configured service URL to an origin, and insists on HTTPS outside localhost. */
export function normalizeServiceUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`Gatecrypt: serviceUrl "${input}" is not a URL`);
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error(`Gatecrypt: serviceUrl must be https (got "${input}")`);
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`Gatecrypt: serviceUrl must be just an origin, like https://gate.example.com (got "${input}")`);
  }
  return url.origin;
}
