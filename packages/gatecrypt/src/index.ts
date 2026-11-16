/**
 * Build-time API, for build tools other than Vite. Most sites only need the
 * Vite plugin (`gatecrypt/vite`) or the CLI (`npx gatecrypt encrypt dist`);
 * this is what both of them call.
 */
export {
  DEFAULT_SERVICE_URL,
  checkSetup,
  protectSite,
  type CommonOptions,
  type ProtectOptions,
  type ProtectResult,
} from './protect.js';
export { NotASiteError } from './encrypt-site.js';
export type { ProjectInfo } from './register.js';
export { DEFAULT_TEXT, type LoaderText } from './text.js';
export { VERSION } from './version.js';
