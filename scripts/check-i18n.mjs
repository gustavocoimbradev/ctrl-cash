// Checks the translations: every static t('...') text of the app has an entry in each language, with the same
// {placeholders}, and no dictionary entry is empty. Run with `npm run check:i18n`.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const LANGS = ['pt', 'es', 'de', 'fr', 'it'];

const merged = Object.fromEntries(LANGS.map((l) => [l, {}]));
const problems = [];
const holders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

for (const file of readdirSync('src/i18n/dict').filter((f) => f.endsWith('.ts'))) {
  const src = readFileSync(join('src/i18n/dict', file), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: () => ({}) });
  const dict = mod.exports.dict;
  for (const l of LANGS) for (const [k, v] of Object.entries(dict[l] ?? {})) {
    if (typeof v !== 'string' || !v.trim()) problems.push(`${file}: [${l}] empty translation for "${k}"`);
    else if (holders(k) !== holders(v)) problems.push(`${file}: [${l}] placeholders differ for "${k}"`);
    merged[l][k] = v;
  }
}

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== 'node_modules' && n !== 'i18n') walk(p, out); }
    else if (/\.(ts|tsx)$/.test(n)) out.push(p);
  }
  return out;
}

// t('text') / t("text") / t(`text`) with a static string as first argument
const CALL = /(?<![\w.$])t\(\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`([^`$\\]*)`)\s*[,)]/g;
const files = [...walk('src'), 'App.tsx'];
const used = new Map();
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(CALL)) {
    const raw = m[1] ?? m[2] ?? m[3];
    const text = raw.replace(/\\(['"`\\])/g, '$1').replace(/\\n/g, '\n');
    if (!used.has(text)) used.set(text, f);
  }
}
for (const [text, f] of used) {
  for (const l of LANGS) if (merged[l][text] === undefined) problems.push(`${f}: no [${l}] translation for "${text}"`);
}

if (problems.length) {
  console.error(problems.slice(0, 80).join('\n'));
  if (problems.length > 80) console.error(`... and ${problems.length - 80} more`);
  console.error(`\n${problems.length} problem(s)`);
  process.exit(1);
}
console.log(`i18n ok: ${used.size} texts used, ${Object.keys(merged.pt).length} entries per language`);
