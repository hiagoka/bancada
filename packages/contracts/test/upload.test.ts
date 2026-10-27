import {
  ALLOWED_UPLOAD_CONTENT_TYPES,
  INVALID_FILE_TYPE_MESSAGE,
  MAX_UPLOAD_BYTES,
  uploadRequestSchema,
  uploadResponseSchema,
} from '../src/index.js';
import { messagesOf } from './fixtures.js';

describe('uploadRequestSchema', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp'])('aceita %s', (contentType) => {
    expect(uploadRequestSchema.safeParse({ contentType }).success).toBe(true);
  });

  it.each(['image/gif', 'image/svg+xml', 'application/pdf', 'text/html', ''])(
    'rejeita %p',
    (contentType) => {
      expect(uploadRequestSchema.safeParse({ contentType }).success).toBe(false);
    },
  );

  it('rejeita tipo inválido com mensagem em PT-BR', () => {
    const result = uploadRequestSchema.safeParse({ contentType: 'image/gif' });
    expect(messagesOf(result)).toContain('Tipo de arquivo não permitido. Use JPEG, PNG ou WebP');
  });
});

describe('uploadResponseSchema', () => {
  it('aceita resposta válida', () => {
    const response = {
      uploadUrl: 'http://localhost:9000/bancada',
      fields: { key: 'products/a.png', Policy: 'x' },
      key: 'products/a.png',
    };
    expect(uploadResponseSchema.parse(response)).toEqual(response);
  });

  it('rejeita fields que não sejam strings', () => {
    expect(
      uploadResponseSchema.safeParse({ uploadUrl: 'http://x', fields: { a: 1 }, key: 'k' }).success,
    ).toBe(false);
  });
});

describe('constantes de upload', () => {
  it('tipos permitidos, limite de 2 MB e mensagem em PT-BR', () => {
    expect([...ALLOWED_UPLOAD_CONTENT_TYPES]).toEqual(['image/jpeg', 'image/png', 'image/webp']);
    expect(MAX_UPLOAD_BYTES).toBe(2 * 1024 * 1024);
    expect(INVALID_FILE_TYPE_MESSAGE).toBe('Tipo de arquivo não permitido. Use JPEG, PNG ou WebP');
  });
});
