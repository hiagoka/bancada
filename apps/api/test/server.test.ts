import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const apiDir = resolve(__dirname, '..');

describe('server.ts com env inválida', () => {
  it('sai com código != 0 e mensagem clara listando as variáveis', () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
      cwd: apiDir,
      env: { PATH: process.env.PATH, PORT: 'abc', JWT_SECRET: 'curto' },
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(result.status).not.toBe(0);
    expect(result.status).not.toBeNull();
    expect(result.stderr).toContain('Variáveis de ambiente inválidas');
    for (const name of ['DATABASE_URL', 'JWT_SECRET', 'PORT']) {
      expect(result.stderr).toContain(name);
    }
  });
});
