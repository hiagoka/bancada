import { parseArgs } from 'node:util';
import { EnvError, loadDatabaseUrl } from '../config/env.js';
import { createPool } from '../db/pool.js';
import {
  AdminEmailTakenError,
  BCRYPT_COST_PRODUCTION,
  createAdminAccount,
  createAdminInputSchema,
} from '../modules/auth/auth.service.js';

// Uso: npm run admin:create -w apps/api -- --email x --password y --name z
// Não existe rota pública de cadastro de admin: este script é o único caminho.
const USAGE =
  'Uso: npm run admin:create -w apps/api -- --email <e-mail> --password <senha> --name <nome>';

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

let values: { email?: string; password?: string; name?: string };
try {
  ({ values } = parseArgs({
    options: {
      email: { type: 'string' },
      password: { type: 'string' },
      name: { type: 'string' },
    },
    strict: true,
  }));
} catch (err) {
  fail(`${err instanceof Error ? err.message : 'Argumentos inválidos'}\n${USAGE}`);
}

if (!values.email || !values.password || !values.name) {
  fail(`Informe --email, --password e --name.\n${USAGE}`);
}

const parsed = createAdminInputSchema.safeParse(values);
if (!parsed.success) {
  // Só as mensagens: nunca ecoa os valores recebidos (a senha).
  fail(parsed.error.issues.map((issue) => `- ${issue.message}`).join('\n'));
}

let databaseUrl: string;
try {
  databaseUrl = loadDatabaseUrl();
} catch (err) {
  if (err instanceof EnvError) fail(err.message);
  throw err;
}

const pool = createPool(databaseUrl);
try {
  const admin = await createAdminAccount(pool, parsed.data, BCRYPT_COST_PRODUCTION);
  process.stdout.write(`Admin criado: id=${admin.id} email=${admin.email}\n`);
} catch (err) {
  if (err instanceof AdminEmailTakenError) {
    process.stderr.write(`${err.message}\n`);
  } else {
    process.stderr.write(
      `Não foi possível criar o admin: ${err instanceof Error ? err.message : 'erro desconhecido'}\n`,
    );
  }
  process.exitCode = 1;
} finally {
  await pool.end();
}
