import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { compare } from 'bcryptjs';
import { createPool } from '../src/db/pool.js';
import { createAdminInputSchema } from '../src/modules/auth/auth.service.js';
import { resetDb } from './db-helpers.js';
import { testDatabaseUrl } from './helpers.js';

const apiDir = resolve(__dirname, '..');
const pool = createPool(testDatabaseUrl());

beforeEach(async () => {
  await resetDb(pool);
});

afterAll(async () => {
  await pool.end();
});

function run(args: string[], env: Record<string, string | undefined> = {}) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/scripts/create-admin.ts', ...args], {
    cwd: apiDir,
    env: { PATH: process.env.PATH, DATABASE_URL: testDatabaseUrl(), ...env },
    encoding: 'utf8',
    timeout: 60_000,
  });
}

async function admins() {
  const { rows } = await pool.query('SELECT id, email, name, password_hash FROM admins');
  return rows;
}

const good = [
  '--email',
  'Novo.Admin@Bancada.dev',
  '--password',
  'senha-longa-123',
  '--name',
  'Novo Admin',
];

describe('createAdminInputSchema', () => {
  it('normaliza o e-mail e valida os campos em PT-BR', () => {
    expect(
      createAdminInputSchema.parse({ email: ' A@B.com ', password: '1234567890', name: ' Ana ' }),
    ).toEqual({ email: 'a@b.com', password: '1234567890', name: 'Ana' });
    const bad = createAdminInputSchema.safeParse({ email: 'x', password: '123456789', name: ' ' });
    const messages = bad.error?.issues.map((i) => i.message) ?? [];
    expect(messages).toEqual(
      expect.arrayContaining([
        'Informe um e-mail válido',
        'A senha deve ter no mínimo 10 caracteres',
        'Informe o nome',
      ]),
    );
  });

  it('limita a senha a 72 BYTES (o bcrypt trunca em silêncio acima disso)', () => {
    const accents = (n: number) => 'é'.repeat(n); // 2 bytes cada
    const base = { email: 'a@b.com', name: 'Ana' };
    expect(createAdminInputSchema.safeParse({ ...base, password: accents(36) }).success).toBe(true);
    expect(createAdminInputSchema.safeParse({ ...base, password: accents(37) }).success).toBe(
      false,
    );
  });

  it('limita a senha a 72 caracteres (limite do bcrypt)', () => {
    const result = createAdminInputSchema.safeParse({
      email: 'a@b.com',
      password: 'x'.repeat(73),
      name: 'Ana',
    });
    expect(result.success).toBe(false);
  });
});

describe('npm run admin:create (script)', () => {
  it('cria o admin: e-mail em minúsculo, hash bcrypt custo 12, imprime só id e e-mail', async () => {
    const result = run(good);
    expect(result.status).toBe(0);
    const [row, ...rest] = await admins();
    expect(rest).toHaveLength(0);
    expect(row).toMatchObject({ email: 'novo.admin@bancada.dev', name: 'Novo Admin' });
    expect(row.password_hash).toMatch(/^\$2[aby]\$12\$/);
    await expect(compare('senha-longa-123', row.password_hash)).resolves.toBe(true);
    expect(result.stdout).toContain(row.id);
    expect(result.stdout).toContain('novo.admin@bancada.dev');
    expect(result.stdout + result.stderr).not.toContain('senha-longa-123');
    expect(result.stdout + result.stderr).not.toContain(row.password_hash);
  });

  it('senha curta: código 1, mensagem em PT-BR, nada gravado e a senha não aparece', async () => {
    const result = run(['--email', 'a@b.com', '--password', 'curta123', '--name', 'Ana']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('A senha deve ter no mínimo 10 caracteres');
    expect(result.stderr).not.toContain('curta123');
    expect(await admins()).toHaveLength(0);
  });

  it('e-mail repetido (mesmo com outra caixa): mensagem clara, código 1, um único admin', async () => {
    expect(run(good).status).toBe(0);
    const again = run([
      '--email',
      'NOVO.admin@bancada.DEV',
      '--password',
      'outra-senha-123',
      '--name',
      'X',
    ]);
    expect(again.status).toBe(1);
    expect(again.stderr).toContain('Já existe um admin com o e-mail novo.admin@bancada.dev');
    expect(again.stderr).not.toContain('outra-senha-123');
    expect(await admins()).toHaveLength(1);
  });

  it('e-mail inválido e nome vazio: código 1 listando os problemas', async () => {
    const result = run(['--email', 'nao-e-email', '--password', 'senha-longa-123', '--name', ' ']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Informe um e-mail válido');
    expect(result.stderr).toContain('Informe o nome');
    expect(await admins()).toHaveLength(0);
  });

  it('argumentos ausentes: código 1 com o modo de usar', () => {
    const result = run([]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--email');
    expect(result.stderr).toContain('--password');
    expect(result.stderr).toContain('--name');
  });

  it('opção desconhecida: código 1', () => {
    const result = run([...good, '--admin', 'sim']);
    expect(result.status).toBe(1);
  });

  it('sem DATABASE_URL: código 1 com mensagem clara', () => {
    const result = run(good, { DATABASE_URL: '' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('DATABASE_URL');
  });

  it('o admin criado consegue logar pela API', async () => {
    expect(run(good).status).toBe(0);
    const { createApp } = await import('../src/app.js');
    const { FakePaymentGateway } = await import('../src/modules/payments/fake.gateway.js');
    const { FakeStorageService } = await import('../src/modules/storage/fake.storage.js');
    const { default: request } = await import('supertest');
    const { authDeps, silentLogger } = await import('./helpers.js');
    const webUrl = 'http://localhost:5173';
    const app = createApp({
      ...authDeps,
      pool,
      logger: silentLogger,
      webUrl,
      storage: new FakeStorageService(),
      gateway: new FakePaymentGateway({ webUrl }),
    });
    const res = await request(app)
      .post('/auth/login')
      .set({ 'X-Requested-With': 'bancada-web', 'Content-Type': 'application/json' })
      .send({ email: 'novo.admin@bancada.dev', password: 'senha-longa-123' });
    expect(res.status).toBe(200);
  });
});
