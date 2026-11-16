import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { DEFAULT_SERVICE_URL, checkSetup, discardSite, protectSite, summary, type CommonOptions } from './protect.js';
import { VERSION } from './version.js';

const HELP = `gatecrypt ${VERSION}: put a static site behind a sign-in

Usage
  gatecrypt encrypt <dir> [options]   Encrypt the finished build in <dir>, in place, and register its key
  gatecrypt check [options]           Check that the project ID and deploy token work; changes nothing

  The deploy token is read from the GATECRYPT_DEPLOY_TOKEN environment variable.

Options
  --project <id>        Project ID from the Gatecrypt dashboard
                        (default: the GATECRYPT_PROJECT_ID environment variable)
  --service <url>       Gatecrypt service
                        (default: GATECRYPT_SERVICE_URL, then ${DEFAULT_SERVICE_URL})

Options for encrypt
  --base <path>         Path the site is served under (default "/")
  --passthrough <path>  Leave a file or "dir/" in plaintext; repeatable
                        (default: CNAME and .nojekyll)
  --no-spa-fallback     Do not serve index.html for unknown paths
  --api <address>       Your own API, such as https://api.example.com or /api:
                        calls to it carry the visitor's token; repeatable
                        (default: the GATECRYPT_API environment variable)
  --title <text>        Heading of the sign-in page
  --lang <tag>          Language of the sign-in page, such as "de" (default "en")
  --text <file>         JSON file of replacements for the sign-in page's sentences

  -v, --version         Show the version
  -h, --help            Show this help

https://github.com/Gatecrypt/gatecrypt
`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      project: { type: 'string' },
      base: { type: 'string' },
      service: { type: 'string' },
      passthrough: { type: 'string', multiple: true },
      'no-spa-fallback': { type: 'boolean' },
      api: { type: 'string', multiple: true },
      title: { type: 'string' },
      lang: { type: 'string' },
      text: { type: 'string' },
      version: { type: 'boolean', short: 'v' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [command, dir] = positionals;
  if (values.version) return console.log(VERSION);
  if (values.help || !command) return console.log(HELP);

  const common: CommonOptions = { projectId: values.project, serviceUrl: values.service };

  if (command === 'check' && positionals.length === 1) {
    const project = await checkSetup(common);
    console.log(`gatecrypt: the deploy token works for ${project.name ? `"${project.name}"` : 'the project'} (${project.projectId}) at ${project.serviceUrl}`);
    if (project.origins?.length) console.log(`gatecrypt: site addresses: ${project.origins.join(', ')}`);
    else if (project.origins) console.log('gatecrypt: no site address yet. Add the address the site is served from in the dashboard.');
    return;
  }
  if (command !== 'encrypt' || !dir || positionals.length > 2) {
    throw new Error('Usage: gatecrypt encrypt <dir> [options], or gatecrypt check   (see gatecrypt --help)');
  }

  const site = path.resolve(dir);
  try {
    let text: CommonOptions['text'];
    if (values.text) {
      try {
        text = JSON.parse(await readFile(values.text, 'utf8')) as CommonOptions['text'];
      } catch (error) {
        throw new Error(`Gatecrypt: could not read --text ${values.text}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const result = await protectSite({
      ...common,
      dir: site,
      base: values.base,
      passthrough: values.passthrough,
      spaFallback: !values['no-spa-fallback'],
      api: values.api,
      title: values.title,
      lang: values.lang,
      text,
    });
    console.log(summary(result));
  } catch (error) {
    // Whatever went wrong, the folder was meant to be protected: do not leave it deployable.
    await discardSite(site);
    throw error;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
