/**
 * Things in a build that usually mean trouble once it is encrypted. None of
 * them stops the build: each becomes one warning that says what to do.
 */

/** Files a static host reads for its own configuration. Encrypted, the host no longer sees them. */
const HOST_FILES = new Set([
  '_headers',
  '_redirects',
  '_routes.json',
  '_worker.js',
  'staticwebapp.config.json',
  'vercel.json',
  'serve.json',
  '.htaccess',
  'web.config',
  'robots.txt',
]);

/** Names other service workers are usually built under. */
const SERVICE_WORKER = /(^|\/)(sw|service-worker|serviceworker|ngsw-worker|firebase-messaging-sw|registerSW|workbox-[\w.-]+)\.js$/i;

/** `encrypted` are the paths that will be encrypted (passthrough files are not among them). */
export function buildWarnings(encrypted: string[]): string[] {
  const warnings: string[] = [];
  const hostFiles = encrypted.filter((file) => HOST_FILES.has(file) || file.startsWith('.well-known/'));
  if (hostFiles.length) {
    warnings.push(
      `gatecrypt: ${list(hostFiles)} ${hostFiles.length === 1 ? 'is a file' : 'are files'} your host or other programs ` +
        `read directly, and encrypted they cannot. To keep ${hostFiles.length === 1 ? 'it' : 'them'} readable (and public), ` +
        `add ${hostFiles.length === 1 ? 'it' : 'them'} to "passthrough".`,
    );
  }
  const workers = encrypted.filter((file) => SERVICE_WORKER.test(file));
  if (workers.length) {
    warnings.push(
      `gatecrypt: ${list(workers)} ${workers.length === 1 ? 'looks' : 'look'} like a service worker. A site can have one ` +
        `service worker per path, and Gatecrypt needs it: if your app registers its own, the site will stop loading. ` +
        `Turn the app's service worker off for this build.`,
    );
  }
  return warnings;
}

const list = (files: string[]): string =>
  files.length <= 4 ? files.join(', ') : `${files.slice(0, 4).join(', ')} and ${files.length - 4} more`;
