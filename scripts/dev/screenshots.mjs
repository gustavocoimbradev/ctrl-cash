// Takes the README screenshots of the running development stack (make up:dev), with the demo account.
//   make screenshots        (it runs this inside a Playwright container, so nothing is installed on your machine)
// Output: docs/screenshots/*.png. Nothing real is shown: the data is the seeded demo account.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';

const { chromium } = createRequire('/tmp/pw/')('playwright');
const BASE = process.env.BASE_URL ?? 'http://localhost:8081';

// With Docker Desktop the container cannot reach the host's localhost: FORWARD_PORTS=8082,19099 makes each of those
// ports on this container's localhost lead to the host (host.docker.internal), so the app and the Auth emulator are found
// at the same addresses the app was built with.
for (const port of (process.env.FORWARD_PORTS ?? '').split(',').filter(Boolean)) {
  net
    .createServer((client) => {
      const upstream = net.connect(Number(port), 'host.docker.internal');
      client.pipe(upstream).pipe(client);
      const stop = () => { client.destroy(); upstream.destroy(); };
      client.on('error', stop); upstream.on('error', stop);
    })
    .listen(Number(port), '::');
}
const OUT = 'docs/screenshots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

/** A fresh browser context (a phone or a desktop), signed out. */
async function open(name, viewport, mobile = false) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile, colorScheme: 'light', reducedMotion: 'no-preference' });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] page error:`, e.message));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  return { context, page };
}

async function signIn(page) {
  await page.getByLabel('Email').fill('demo@ctrlcash.dev');
  await page.getByRole('button', { name: /^Continue$/ }).click();
  await page.getByLabel('Password', { exact: true }).fill('demo1234');
  await page.getByRole('button', { name: /^Sign in$/ }).click();
  await page.getByText('Financial health').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(2500); // the entrance animations and the gauge
}
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });

// ---------------------------------------------------------------- desktop
{
  const { context, page } = await open('desktop', { width: 1440, height: 900 });
  await page.waitForTimeout(3500); // the 3D coins
  await shot(page, 'login');
  await signIn(page);
  await shot(page, 'dashboard');

  // the transactions table with its sticky header and the month summary
  await page.mouse.wheel(0, 760);
  await page.waitForTimeout(800);
  await shot(page, 'transactions');
  await page.mouse.wheel(0, -2000);
  await page.waitForTimeout(400);

  // a total dialog (accumulated wealth) and the card/category dialogs
  await page.getByRole('button', { name: 'View statement: Accumulated wealth' }).click();
  await page.waitForTimeout(1200);
  await shot(page, 'accumulated');
  await page.keyboard.press('Escape');
  await page.getByLabel('Close').click().catch(() => {});
  await page.waitForTimeout(500);

  await page.getByRole('button', { name: 'Cards' }).first().click();
  await page.waitForTimeout(900);
  await shot(page, 'cards');
  await page.getByLabel('Close').click();
  await page.waitForTimeout(500);

  await page.getByRole('button', { name: 'Categories' }).first().click();
  await page.waitForTimeout(900);
  await shot(page, 'categories');
  await context.close();
}

// ---------------------------------------------------------------- phone
{
  const { context, page } = await open('phone', { width: 390, height: 844 }, true);
  await page.waitForTimeout(2500);
  await shot(page, 'mobile-login');
  await signIn(page);
  await shot(page, 'mobile-summary');
  await page.getByRole('tab', { name: 'Projection' }).click();
  await page.waitForTimeout(1800);
  await shot(page, 'mobile-projection');
  await page.getByRole('tab', { name: 'Transactions' }).click();
  await page.waitForTimeout(1500);
  await shot(page, 'mobile-transactions');
  await context.close();
}

await browser.close();
console.log(`Screenshots saved in ${OUT}/`);
// the port forwarders keep the event loop open
process.exit(0);
