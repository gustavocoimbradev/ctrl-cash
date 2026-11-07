// Post-build: replaces the placeholder domain (https://YOUR-DOMAIN) with the real domain in the SEO files in `dist/`.
// Uses SITE_URL (e.g. https://ctrlcash.com.br); the production Docker build passes it from PUBLIC_URL.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PLACEHOLDER = 'https://YOUR-DOMAIN';
const site = (process.env.SITE_URL || '').replace(/\/$/, '');
if (!site) {
  console.warn('SEO: set SITE_URL (e.g. https://ctrlcash.com.br). The SEO files kept the placeholder domain.');
  process.exit(0);
}
let changed = 0;
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(html|txt|xml|json)$/.test(name)) {
      const text = readFileSync(path, 'utf8');
      if (text.includes(PLACEHOLDER)) {
        writeFileSync(path, text.replaceAll(PLACEHOLDER, site));
        changed++;
      }
    }
  }
};
walk('dist');
console.log(`SEO: domain ${site} applied to ${changed} file(s).`);
