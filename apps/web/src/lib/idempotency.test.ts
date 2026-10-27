import { afterEach, describe, expect, it, vi } from 'vitest';
import { newIdempotencyKey } from './idempotency';

describe('newIdempotencyKey', () => {
  it('gera um UUID v4', () => {
    expect(newIdempotencyKey()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('gera chaves diferentes e cabe no limite de 255 caracteres da API', () => {
    const keys = new Set(Array.from({ length: 50 }, () => newIdempotencyKey()));
    expect(keys.size).toBe(50);
    for (const key of keys) expect(key.length).toBeLessThanOrEqual(255);
  });
});

describe('newIdempotencyKey sem crypto.randomUUID (contexto não seguro: HTTP fora de localhost)', () => {
  afterEach(() => vi.unstubAllGlobals());

  const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it('usa getRandomValues e ainda gera um UUID v4 válido e único', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
    });
    const keys = new Set(Array.from({ length: 200 }, () => newIdempotencyKey()));
    expect(keys.size).toBe(200);
    for (const key of keys) expect(key).toMatch(V4);
  });

  it('prefere randomUUID quando existe', () => {
    vi.stubGlobal('crypto', {
      randomUUID: () => '11111111-2222-4333-8444-555555555555',
      getRandomValues: () => {
        throw new Error('não deveria ser usado');
      },
    });
    expect(newIdempotencyKey()).toBe('11111111-2222-4333-8444-555555555555');
  });
});
