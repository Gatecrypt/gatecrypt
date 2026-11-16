import { mergeText, type LoaderText } from './text.js';

export interface LoaderPageOptions {
  /** Site base path the loader resolves its files against, e.g. "/" or "/repo/" or "./". */
  base: string;
  /** Built loader script (IIFE). */
  loaderJs: string;
  /** The page's language, as a BCP 47 tag. Default "en". */
  lang?: string;
  /** Replacements for the page's built-in sentences. */
  text?: Partial<LoaderText>;
}

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const STYLE = `
:root{color-scheme:light dark;--a:#18181b;--c:#fff;--l:#d4d4d8;--m:#52525b;--e:#b91c1c}
body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 system-ui,sans-serif;background:#f4f4f5;color:#18181b}
main{width:min(22rem,calc(100vw - 3rem));padding:2rem;border-radius:12px;background:#fff;box-shadow:0 1px 3px #0002;text-align:center}
h1{margin:0 0 .5rem;font-size:1.25rem}
img{display:block;max-width:10rem;max-height:4rem;margin:0 auto 1rem}
[hidden]{display:none!important}
[data-state=loading] main{visibility:hidden}
p{margin:0 0 1.25rem;color:var(--m);min-height:1.5em}
form{display:grid;gap:.6rem;margin:0}
button,input{font:inherit;width:100%;box-sizing:border-box;padding:.6rem .8rem;border-radius:8px}
button{font-weight:600;border:1px solid var(--a);background:var(--a);color:var(--c);cursor:pointer}
button.s,[data-state=waiting] #gc-b,[data-state=code] #gc-b,[data-state=wrong] #gc-b{font-weight:400;border-color:var(--l);background:none;color:inherit}
[data-state=code] #gc-b,[data-state=wrong] #gc-b{margin-top:.6rem}
input{border:1px solid var(--l);background:none;color:inherit}
#gc-d{font:1.4rem ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.35em;text-align:center}
:disabled{opacity:.6;cursor:default}
:focus-visible{outline:3px solid #60a5fa;outline-offset:2px}
#gc-o{display:flex;align-items:center;gap:.75rem;margin:1rem 0;color:var(--m);font-size:.85rem}
#gc-o::before,#gc-o::after{content:"";flex:1;height:1px;background:var(--l)}
a{position:fixed;right:1rem;bottom:.75rem;font-size:.75rem;color:var(--m);text-decoration:none}
a:hover{text-decoration:underline}
[data-state=denied] p,[data-state=failed] p,[data-state=wrong] p,[data-state=error] p,[data-state=unreachable] p,[data-state=blocked] p{color:var(--e)}
@media (prefers-color-scheme:dark){:root{--a:#fafafa;--c:#18181b;--l:#52525b;--m:#a1a1aa;--e:#fca5a5}body{background:#18181b;color:#fafafa}main{background:#27272a}}
`.replace(/\n/g, '');

/** The only page shipped in plaintext. Everything in it is generic: nothing from the site itself. */
export function renderLoaderPage(options: LoaderPageOptions): string {
  const text = mergeText(options.text);
  const t = (key: keyof LoaderText): string => escapeHtml(text[key]);
  // A literal "</script" inside an inline script would end it early.
  const script = options.loaderJs.replace(/<\/(script)/gi, '<\\/$1');
  // The loader has the English sentences built in; it is handed only the ones that differ.
  const replaced = options.text && Object.keys(options.text).length ? ` data-text="${escapeHtml(JSON.stringify(options.text))}"` : '';
  return (
    `<!doctype html><html lang="${escapeHtml(options.lang ?? 'en')}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex"><meta name="referrer" content="no-referrer">` +
    `<title>${t('title')}</title><style>${STYLE}</style></head>` +
    `<body data-state="loading"><main><img id="gc-l" alt="" hidden><h1 id="gc-h">${t('title')}</h1>` +
    `<p id="gc-m" role="status">${t('loading')}</p>` +
    `<button id="gc-g" type="button" hidden>${t('google')}</button>` +
    `<div id="gc-o" hidden>${t('or')}</div>` +
    `<form id="gc-e" hidden><input id="gc-a" type="email" required autocomplete="email" placeholder="${t('emailPlaceholder')}" aria-label="${t('emailLabel')}">` +
    `<button>${t('sendCode')}</button></form>` +
    `<form id="gc-c" hidden><input id="gc-d" required inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" aria-label="${t('codeLabel')}">` +
    `<button>${t('submitCode')}</button></form>` +
    `<button id="gc-b" type="button" hidden></button>` +
    `<noscript><p>${t('noScript')}</p></noscript></main>` +
    `<a href="https://gatecrypt.dev" target="_blank" rel="noopener">Powered by Gatecrypt</a>` +
    `<script data-base="${escapeHtml(options.base)}"${replaced}>${script}</script></body></html>\n`
  );
}
