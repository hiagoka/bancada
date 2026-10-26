import { spawn, spawnSync } from 'node:child_process';
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

describe('server.ts: provedor fake em produção', () => {
  const baseEnv = {
    PATH: process.env.PATH,
    DATABASE_URL: testDatabaseUrl(),
    JWT_SECRET: 'x'.repeat(32),
    NODE_ENV: 'production',
    PAYMENT_PROVIDER: 'fake',
  };

  it('recusa subir sem ALLOW_FAKE_PAYMENTS, com mensagem clara em PT-BR e código != 0', () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
      cwd: apiDir,
      env: baseEnv,
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Variáveis de ambiente inválidas');
    expect(result.stderr).toContain('PAYMENT_PROVIDER');
    expect(result.stderr).toContain('produção');
    expect(result.stderr).toContain('ALLOW_FAKE_PAYMENTS=true');
    expect(result.stdout).not.toContain('API no ar');
  });

  it('com ALLOW_FAKE_PAYMENTS=true sobe, com warn de pagamentos simulados', async () => {
    const probe = createServer();
    await new Promise<void>((resolveListen) => probe.listen(0, resolveListen));
    const { port } = probe.address() as AddressInfo;
    await new Promise((resolveClose) => probe.close(resolveClose));

    const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
      cwd: apiDir,
      env: { ...baseEnv, ALLOW_FAKE_PAYMENTS: 'true', PORT: String(port) },
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    try {
      await new Promise<void>((resolveReady, reject) => {
        const timer = setTimeout(() => reject(new Error(`servidor não subiu: ${output}`)), 20_000);
        child.stdout.on('data', () => {
          if (output.includes('API no ar')) {
            clearTimeout(timer);
            resolveReady();
          }
        });
        child.on('exit', (code) => reject(new Error(`servidor saiu (${code}): ${output}`)));
      });
      const warn = output
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .find((line) => line.level === 40);
      expect(String(warn?.msg)).toContain('PAYMENT_PROVIDER=fake em produção');
    } finally {
      child.removeAllListeners('exit');
      child.kill('SIGTERM');
      await new Promise((resolveExit) => child.once('exit', resolveExit));
    }
  }, 40_000);
});
