import express, { type Express } from 'express';
import request from 'supertest';
import { z } from 'zod';
import { AppError } from '../src/shared/errors.js';
import { errorHandler, notFoundHandler, validateBody } from '../src/shared/http.js';
import { silentLogger } from './helpers.js';

const schema = z.object({
  name: z.string().min(1, { error: 'Informe o nome' }),
  age: z.number({ error: 'Informe a idade' }).int(),
});

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.post('/echo', validateBody(schema), (req, res) => {
    res.json({ data: req.body });
  });
  app.get('/app-error', () => {
    throw new AppError(409, 'OUT_OF_STOCK', 'Estoque insuficiente', [{ productId: 'p1' }]);
  });
  app.get('/app-error-sem-details', () => {
    throw new AppError(404, 'NOT_FOUND', 'Não encontrado');
  });
  app.get('/boom', () => {
    throw new Error('segredo interno do banco');
  });
  app.get('/async-boom', async () => {
    throw new Error('falha assíncrona');
  });
  app.use(notFoundHandler);
  app.use(errorHandler(silentLogger));
  return app;
}

describe('AppError', () => {
  it('carrega status, code, message e details', () => {
    const err = new AppError(422, 'PRODUCT_UNAVAILABLE', 'Indisponível', { id: 1 });
    expect(err).toBeInstanceOf(Error);
    expect(err).toMatchObject({
      status: 422,
      code: 'PRODUCT_UNAVAILABLE',
      message: 'Indisponível',
      details: { id: 1 },
    });
  });
});

describe('validateBody + errorHandler', () => {
  it('entrega o body já validado à rota', async () => {
    const res = await request(buildApp()).post('/echo').send({ name: 'Ana', age: 30, extra: 1 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { name: 'Ana', age: 30 } });
  });

  it('converte ZodError em 400 VALIDATION_ERROR com mensagens PT-BR e details', async () => {
    const res = await request(buildApp()).post('/echo').send({ name: '', age: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toBe('Dados inválidos');
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([
        { path: 'name', message: 'Informe o nome' },
        { path: 'age', message: 'Informe a idade' },
      ]),
    );
  });

  it('erro 4xx do body-parser (encoding não suportado) vira 400, não 500', async () => {
    const res = await request(buildApp())
      .post('/echo')
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'foo')
      .send('{}');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('body ausente também vira VALIDATION_ERROR', async () => {
    const res = await request(buildApp()).post('/echo');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('JSON malformado: 400 INVALID_JSON', async () => {
    const res = await request(buildApp())
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send('{"name": ');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: 'INVALID_JSON', message: 'O corpo da requisição não é um JSON válido' },
    });
  });
});

describe('errorHandler', () => {
  it('AppError usa status/code/message/details', async () => {
    const res = await request(buildApp()).get('/app-error');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: {
        code: 'OUT_OF_STOCK',
        message: 'Estoque insuficiente',
        details: [{ productId: 'p1' }],
      },
    });
  });

  it('omite details quando não há', async () => {
    const res = await request(buildApp()).get('/app-error-sem-details');
    expect(res.body.error).not.toHaveProperty('details');
  });

  it('erro inesperado: 500 INTERNAL_ERROR sem vazar a mensagem original', async () => {
    const res = await request(buildApp()).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('segredo interno');
  });

  it('erro assíncrono também é capturado (Express 5)', async () => {
    const res = await request(buildApp()).get('/async-boom');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });

  it('registra erro inesperado no logger (Pino)', async () => {
    const logger = { error: jest.fn() };
    const app = express();
    app.get('/boom', () => {
      throw new Error('x');
    });
    app.use(errorHandler(logger as never));
    await request(app).get('/boom');
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('rota desconhecida: 404 NOT_FOUND no envelope', async () => {
    const res = await request(buildApp()).get('/nao-existe');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
