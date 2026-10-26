// Roda depois do build (script "postbuild"): confere que as migrações foram copiadas para dist.
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist/db/migrations');
assert.ok(existsSync(resolve(dist, '001_init.sql')), 'dist/db/migrations/001_init.sql não existe');
const source = readdirSync(resolve(root, 'src/db/migrations')).filter((f) => f.endsWith('.sql'));
for (const file of source) {
  assert.ok(existsSync(resolve(dist, file)), `dist/db/migrations/${file} não foi copiado`);
}
assert.ok(existsSync(resolve(root, 'dist/db/migrate.cli.js')), 'dist/db/migrate.cli.js não existe');
