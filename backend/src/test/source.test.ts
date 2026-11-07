import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? (n === 'node_modules' || n === 'dist' ? [] : files(p)) : [p];
  });
}

test('there is no SQL DELETE anywhere in the source or migrations (soft delete only)', () => {
  const targets = [...files('src'), ...files('migrations')].filter((p) => !p.endsWith('source.test.ts'));
  assert.ok(targets.length > 5);
  for (const p of targets) {
    const t = readFileSync(p, 'utf8');
    assert.ok(!/delete\s+from/i.test(t), `${p} contains DELETE FROM`);
    assert.ok(!/\btruncate\b/i.test(t), `${p} contains TRUNCATE`);
    assert.ok(!/\bdrop\s+table/i.test(t), `${p} contains DROP TABLE`);
  }
});

test('there is no DELETE route in the app', () => {
  const t = readFileSync('src/app.ts', 'utf8');
  assert.ok(!/method:\s*\[?\s*['"]DELETE/i.test(t) && !/app\.delete\(/.test(t));
});
