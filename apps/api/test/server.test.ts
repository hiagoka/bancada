import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { testDatabaseUrl } from './helpers.js';

const apiDir = resolve(__dirname, '..');

describe('server.ts com a porta ocupada', () => {
  it('sai com código != 0 em vez de fingir que subiu', async () => {
    const blocker = createServer();
    await new Promise<void>((resolveListen) => blocker.listen(0, resolveListen));
    const { port } = blocker.address() as AddressInfo;
    try {
      const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
        cwd: apiDir,
        env: {
          PATH: process.env.PATH,
          PORT: String(port),
          DATABASE_URL: testDatabaseUrl(),
          JWT_SECRET: 'x'.repeat(32),
        },
        encoding: 'utf8',
        timeout: 30_000,
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('Não foi possível abrir a porta');
      expect(result.stdout).not.toContain('API no ar');
    } finally {
      await new Promise((resolveClose) => blocker.close(resolveClose));
    }
  });
});

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
