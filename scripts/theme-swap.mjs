// Switches the app palette between the original BLUE theme and the GREEN test theme.
//   npm run theme -- green    applies the green palette
//   npm run theme -- blue     goes back to the blue palette
//   npm run theme -- status   tells which one is active
// It rewrites color values (hex, 0xRRGGBB and rgba prefixes) in the app source and the public
// files, using the table below in both directions. The PNG assets (app icon, splash, og-image.png,
// logo-512.png) are images and are NOT changed by this script.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// [blue, green]. Keep every value unique on both sides, so the swap can be undone exactly.
export const PAIRS = [
  // brand and accent
  ['#2D55D9', '#1F9D6B'], ['#2447BD', '#177F55'], ['#3D65EB', '#2FBF85'], ['#4C74F0', '#3BB783'],
  ['#6F8FF5', '#5FCB9F'], ['#2F80ED', '#17A673'],
  ['#0EA5E9', '#14B8A6'],
  // (income stays green in both palettes, so it is not swapped)
  // dark panels (navy -> deep forest) and their text
  ['#0B192C', '#0A211B'], ['#0E2240', '#0E2F25'], ['#0B1E3F', '#0A241C'], ['#1E2950', '#1C3A30'],
  ['#9FB0CC', '#9DC4B6'], ['#B4C3E2', '#B7D6C9'],
  // 3D coins and light tints
  ['#9DB4FF', '#A6E3C8'], ['#7C9BFF', '#6CCFA3'], ['#4C6FEA', '#2FA877'], ['#2F52D8', '#1F7A58'],
  ['0x5b82ff', '0x3ddc97'], ['0x9db4ff', '0xa6e3c8'], ['0xdfe8ff', '0xe3f7ee'], ['0xbcd0ff', '0xc4ecd9'],
  // surfaces and text
  ['#F3F5F9', '#F3F7F5'], ['#EDF1F8', '#EAF2EE'], ['#E3E9F5', '#DDEBE4'], ['#F8FAFD', '#F8FBF9'],
  ['#F4F7FB', '#F4F8F6'], ['#E6F4FE', '#E4F5EC'], ['#66728C', '#5F7A70'], ['#0F1B33', '#0E2119'],
  // translucent versions
  ['rgba(61,101,235', 'rgba(31,157,107'], ['rgba(61,90,254', 'rgba(31,157,108'], ['rgba(45,85,217', 'rgba(31,157,109'],
  ['rgba(14,34,64', 'rgba(14,47,37'], ['rgba(11,25,44', 'rgba(10,33,27'], ['rgba(15,27,51', 'rgba(14,33,25'],
];

const ROOTS = ['src', 'App.tsx', 'public/index.html', 'public/og-image.svg', 'public/favicon.svg', 'app.json'];
const files = [];
const walk = (p) => {
  if (statSync(p).isDirectory()) readdirSync(p).forEach((n) => walk(join(p, n)));
  else if (/\.(tsx?|html|svg|json)$/.test(p)) files.push(p);
};
ROOTS.forEach(walk);

const mode = process.argv[2] ?? 'status';
if (!['green', 'blue', 'status'].includes(mode)) {
  console.error('Usage: npm run theme -- green|blue|status');
  process.exit(1);
}
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

if (mode === 'status') {
  const theme = readFileSync('src/theme/index.ts', 'utf8').toLowerCase();
  console.log('active theme:', theme.includes('#1f9d6b') ? 'green' : theme.includes('#2d55d9') ? 'blue' : 'unknown');
  process.exit(0);
}
const from = mode === 'green' ? 0 : 1;
const to = 1 - from;
// one pass with a single regex: the swapped values can never be swapped again
const map = new Map(PAIRS.map((p) => [p[from].toLowerCase(), p[to]]));
const re = new RegExp(PAIRS.map((p) => escape(p[from])).join('|'), 'gi');
let changed = 0;
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  const next = text.replace(re, (m) => map.get(m.toLowerCase()));
  if (next !== text) {
    writeFileSync(f, next);
    changed++;
  }
}
console.log(`theme ${mode}: ${changed} file(s) updated.`);
