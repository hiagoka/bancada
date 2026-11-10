import {
  sendJson,
  startFakeAbacatePay as startCore,
  type FakeAbacatePayServer,
  type RecordedRequest,
  type Responder,
} from '../scripts/fake-abacatepay.js';

// Servidor HTTP FALSO da AbacatePay para os testes: a MESMA implementação da ferramenta de
// desenvolvimento (scripts/fake-abacatepay.ts), com ids, copia e cola e QR Code fixos para os testes
// poderem comparar valores. Nada de rede real.
export const FAKE_QR_IMAGE = 'data:image/png;base64,iVBORw0KGgo=';
export const FAKE_BR_CODE = '00020101021226950014br.gov.bcb.pix0136pix-de-teste';

export type FakeAbacatePay = FakeAbacatePayServer;
export type { RecordedRequest, Responder };
export { sendJson };

export function startFakeAbacatePay(): Promise<FakeAbacatePay> {
  return startCore({
    chargeId: (n) => `pix_char_fake${n}`,
    brCode: () => FAKE_BR_CODE,
    qrImage: () => FAKE_QR_IMAGE,
  });
}
