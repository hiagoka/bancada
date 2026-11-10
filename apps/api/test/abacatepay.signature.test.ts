import {
  ABACATEPAY_PUBLIC_KEY,
  abacatePaySignature,
  safeEqual,
  verifyAbacatePayWebhook,
} from '../src/modules/payments/abacatepay.signature.js';

const SECRET = 'segredo-do-webhook-com-no-minimo-32-caracteres';

describe('ABACATEPAY_PUBLIC_KEY', () => {
  it('é a constante da documentação: 256 caracteres alfanuméricos', () => {
    expect(ABACATEPAY_PUBLIC_KEY).toHaveLength(256);
    expect(ABACATEPAY_PUBLIC_KEY).toMatch(/^[A-Za-z0-9]+$/);
    expect(ABACATEPAY_PUBLIC_KEY.startsWith('t9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCpl')).toBe(
      true,
    );
    expect(ABACATEPAY_PUBLIC_KEY.endsWith('kr9HS1JhNHDX9')).toBe(true);
  });

  // Vetores calculados FORA do código (python hmac + openssl dgst -hmac) com a chave copiada da
  // página de segurança da documentação: pegam qualquer erro de digitação na constante.
  it.each([
    ['{"a":1}', 'ER4l7Vb5oHlFF7Uh5Ht6J1xNiEYeHU3+xGPeJUTYUeI='],
    ['', 'E4jCkg+1E7WtCArNby4ta2lwiZ/QPe0hp65rac+8z8Q='],
    [
      '{"event":"transparent.completed","data":{"transparent":{"id":"pix_char_abc"}}}',
      'pzr6BTkYAnlPNs72BKVUfAMEjKSWADV7LE2H56W8fCs=',
    ],
  ])('HMAC-SHA256 em base64 de %j', (body, expected) => {
    expect(abacatePaySignature(body)).toBe(expected);
    expect(abacatePaySignature(Buffer.from(body))).toBe(expected);
  });
});

describe('safeEqual', () => {
  it.each([
    ['igual', 'igual', true],
    ['igual', 'Igual', false],
    ['curto', 'curto-demais-para-bater', false],
    ['', '', true],
    ['', 'x', false],
    ['á', 'á', true],
  ])('%j vs %j -> %s (qualquer tamanho, sem lançar)', (a, b, expected) => {
    expect(safeEqual(a, b)).toBe(expected);
  });
});

describe('verifyAbacatePayWebhook', () => {
  const rawBody = Buffer.from('{"event":"transparent.completed"}');
  const good = {
    rawBody,
    secretHeader: SECRET,
    signatureHeader: abacatePaySignature(rawBody),
    expectedSecret: SECRET,
  };

  it('aceita secret e assinatura corretos', () => {
    expect(verifyAbacatePayWebhook(good)).toBe(true);
  });

  it.each([
    ['secret ausente', { secretHeader: undefined }],
    ['secret errado', { secretHeader: 'outro' }],
    ['secret só com o prefixo', { secretHeader: SECRET.slice(0, 20) }],
    ['secret com sufixo a mais', { secretHeader: `${SECRET}x` }],
    ['assinatura ausente', { signatureHeader: undefined }],
    ['assinatura errada', { signatureHeader: 'AAAA' }],
    ['assinatura vazia', { signatureHeader: '' }],
    ['assinatura de outro corpo', { signatureHeader: abacatePaySignature('{"outro":true}') }],
  ])('recusa: %s', (_nome, override) => {
    expect(verifyAbacatePayWebhook({ ...good, ...override })).toBe(false);
  });

  it('a assinatura é sobre os BYTES: o mesmo JSON reserializado não confere', () => {
    const original = Buffer.from('{ "event": "transparent.completed", "data": {} }\n');
    const signature = abacatePaySignature(original);
    const base = { ...good, rawBody: original, signatureHeader: signature };
    expect(verifyAbacatePayWebhook(base)).toBe(true);
    const reserialized = Buffer.from(JSON.stringify(JSON.parse(original.toString())));
    expect(reserialized.equals(original)).toBe(false);
    expect(verifyAbacatePayWebhook({ ...base, rawBody: reserialized })).toBe(false);
  });

  it('com o secret ausente a assinatura correta não basta (e vice-versa)', () => {
    expect(verifyAbacatePayWebhook({ ...good, secretHeader: undefined })).toBe(false);
    expect(verifyAbacatePayWebhook({ ...good, signatureHeader: undefined })).toBe(false);
  });

  it('falha fechada: um expectedSecret vazio nunca aceita nada (nem header vazio)', () => {
    expect(verifyAbacatePayWebhook({ ...good, expectedSecret: '', secretHeader: '' })).toBe(false);
  });
});
