// Verifica, contra a API em execução, o CORS que o navegador exige do web (D15):
// Access-Control-Allow-Origin = origem do web, Allow-Credentials = true, e o preflight libera
// X-Requested-With e Content-Type. Uso: node scripts/verify-api-cors.mjs
// Variáveis: VITE_API_URL (padrão http://localhost:3333), WEB_ORIGIN (padrão http://localhost:5173).
import assert from 'node:assert/strict';

const api = (process.env.VITE_API_URL ?? 'http://localhost:3333').replace(/\/+$/, '');
const origin = process.env.WEB_ORIGIN ?? 'http://localhost:5173';

const get = await fetch(`${api}/products`, {
  headers: { Origin: origin, 'X-Requested-With': 'bancada-web' },
});
assert.equal(get.status, 200, `GET /products deveria dar 200 (deu ${get.status})`);
assert.equal(
  get.headers.get('access-control-allow-origin'),
  origin,
  'Allow-Origin diferente da origem do web',
);
assert.equal(
  get.headers.get('access-control-allow-credentials'),
  'true',
  'Allow-Credentials deveria ser true',
);
const body = await get.json();
assert.ok(Array.isArray(body.data), 'envelope {data: [...]} esperado');

const preflight = await fetch(`${api}/auth/login`, {
  method: 'OPTIONS',
  headers: {
    Origin: origin,
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'content-type,x-requested-with,idempotency-key',
  },
});
assert.ok(
  preflight.status === 204 || preflight.status === 200,
  `preflight deu ${preflight.status}`,
);
assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
const allowed = (preflight.headers.get('access-control-allow-headers') ?? '').toLowerCase();
for (const header of ['content-type', 'x-requested-with', 'idempotency-key']) {
  assert.ok(allowed.includes(header), `preflight não libera o header ${header}`);
}

const evil = await fetch(`${api}/products`, { headers: { Origin: 'http://evil.example' } });
assert.notEqual(
  evil.headers.get('access-control-allow-origin'),
  'http://evil.example',
  'origem estranha liberada!',
);

process.stdout.write(
  `CORS ok: ${api} libera ${origin} com credentials (${body.data.length} produtos)\n`,
);
