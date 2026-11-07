// Renders scripts/og-image.html to public/og-image.png (1200x630) with a throwaway Chromium (Playwright, in Docker).
//   make og-image
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const { chromium } = createRequire('/tmp/pw/')('playwright');
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })).newPage();
await page.goto(pathToFileURL('/work/scripts/og-image.html').href, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.screenshot({ path: 'public/og-image.png' });
await browser.close();
console.log('public/og-image.png written');
