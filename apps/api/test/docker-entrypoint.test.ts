import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// O Dockerfile não roda no computador de desenvolvimento, então o ponto de entrada é conferido
// aqui: sintaxe do shell e a ORDEM dos passos (migrar, semear se pedido, só então o servidor).
const script = resolve(__dirname, '../docker-entrypoint.sh');
const source = readFileSync(script, 'utf8');
const lines = source
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line !== '' && !line.startsWith('#'));

describe('docker-entrypoint.sh', () => {
  it('é um script sh válido (sh -n)', () => {
    const result = spawnSync('sh', ['-n', script], { encoding: 'utf8' });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('aborta no primeiro erro (set -e): migração que falha não deixa a API subir', () => {
    expect(lines).toContain('set -e');
  });

  it('ordem: migrate, seed (condicional) e por último exec do servidor', () => {
    const migrate = lines.indexOf('node dist/db/migrate.cli.js');
    const seed = lines.indexOf('node dist/db/seed.cli.js');
    const server = lines.indexOf('exec node dist/server.js');
    expect(migrate).toBeGreaterThan(lines.indexOf('set -e'));
    expect(seed).toBeGreaterThan(migrate);
    expect(server).toBeGreaterThan(seed);
    expect(lines.at(-1)).toBe('exec node dist/server.js');
  });

  it('o seed só roda com SEED_ON_START=true', () => {
    const guard = lines.indexOf('if [ "$SEED_ON_START" = "true" ]; then');
    expect(guard).toBeGreaterThan(-1);
    expect(lines[guard + 1]).toBe('node dist/db/seed.cli.js');
    expect(lines[guard + 2]).toBe('fi');
  });
});
