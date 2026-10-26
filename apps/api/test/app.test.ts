import request from 'supertest';
import { createApp } from '../src/app.js';
import { createPool } from '../src/db/pool.js';
import { silentLogger, testDatabaseUrl } from './helpers.js';

const webUrl = 'http://localhost:5173';
const pool = createPool(testDatabaseUrl());
const app = createApp({ pool, logger: silentLogger, webUrl });

afterAll(async () => {
  await pool.end();
});

describe('GET /health', () => {
  it('200 {data:{status:"ok"}} com o banco no ar', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { status: 'ok' } });
  });

  it('500 no envelope de erro quando o banco está inacessível', async () => {
    const broken = createPool('postgres://x:x@127.0.0.1:1/x');
    try {
      const res = await request(createApp({ pool: broken, logger: silentLogger, webUrl })).get(
        '/health',
      );
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
    } finally {
      await broken.end();
    }
  });
});

describe('createApp', () => {
  it('rota inexistente: 404 NOT_FOUND no envelope', async () => {
    const res = await request(app).get('/nao-existe');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('JSON malformado: 400 INVALID_JSON', async () => {
    const res = await request(app)
      .post('/qualquer-rota')
      .set('Content-Type', 'application/json')
      .send('{"a":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('CORS: libera só WEB_URL, com credentials', async () => {
    const res = await request(app).get('/health').set('Origin', webUrl);
    expect(res.headers['access-control-allow-origin']).toBe(webUrl);
    expect(res.headers['access-control-allow-credentials']).toBe('true');

    const other = await request(app).get('/health').set('Origin', 'http://evil.example');
    expect(other.headers['access-control-allow-origin']).not.toBe('http://evil.example');
  });

  it('CORS: preflight permite Content-Type, Idempotency-Key e X-Requested-With', async () => {
    const res = await request(app)
      .options('/health')
      .set('Origin', webUrl)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,idempotency-key,x-requested-with');
    expect(res.status).toBe(204);
    const allowed = String(res.headers['access-control-allow-headers']).toLowerCase();
    for (const h of ['content-type', 'idempotency-key', 'x-requested-with']) {
      expect(allowed).toContain(h);
    }
  });
});
