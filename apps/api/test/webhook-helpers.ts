import { createHmac } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';

export const WEBHOOK_SECRET = 'segredo-do-webhook-de-teste';

export interface SignOptions {
  secret?: string;
  ts?: string;
  requestId?: string;
  // id usado no manifesto; por padrão o mesmo enviado em data.id.
  signedId?: string;
}

// Assinatura real do Mercado Pago: HMAC-SHA256 de "id:<dataId>;request-id:<xRequestId>;ts:<ts>;".
export function sign(dataId: string, options: SignOptions = {}) {
  const ts = options.ts ?? '1700000000';
  const requestId = options.requestId ?? 'req-test-1';
  const manifest = `id:${options.signedId ?? dataId};request-id:${requestId};ts:${ts};`;
  const hash = createHmac('sha256', options.secret ?? WEBHOOK_SECRET)
    .update(manifest)
    .digest('hex');
  return { xSignature: `ts=${ts},v1=${hash}`, xRequestId: requestId, hash };
}

export function notify(app: Express, dataId: string, options: SignOptions = {}) {
  const { xSignature, xRequestId } = sign(dataId, options);
  return request(app)
    .post('/webhooks/mercadopago')
    .query({ type: 'payment', 'data.id': dataId })
    .set('x-signature', xSignature)
    .set('x-request-id', xRequestId)
    .send({ action: 'payment.updated', type: 'payment', data: { id: dataId } });
}
