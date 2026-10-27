import { describe, expect, it } from 'vitest';
import { ApiError, NetworkError } from '../../api/http';
import { describeLoginError } from './loginError';

describe('describeLoginError', () => {
  it('401: a MESMA mensagem, sem pista de qual campo errou', () => {
    const wrongPassword = describeLoginError(
      new ApiError(401, 'INVALID_CREDENTIALS', 'senha errada'),
    );
    const unknownEmail = describeLoginError(
      new ApiError(401, 'INVALID_CREDENTIALS', 'e-mail inexistente'),
    );
    expect(wrongPassword).toBe('E-mail ou senha incorretos.');
    expect(unknownEmail).toBe(wrongPassword);
  });

  it('429: aguardar um minuto', () => {
    expect(describeLoginError(new ApiError(429, 'RATE_LIMITED', 'x'))).toBe(
      'Muitas tentativas. Aguarde um minuto e tente de novo.',
    );
  });

  it('rede: API fora do ar', () => {
    expect(describeLoginError(new NetworkError())).toMatch(/^A API está fora do ar\./);
  });

  it.each([
    new ApiError(403, 'CSRF_REJECTED', 'x'),
    new ApiError(500, 'INTERNAL_ERROR', 'x'),
    new Error('boom'),
  ])('demais erros: mensagem genérica', (error) => {
    expect(describeLoginError(error)).toBe('Não foi possível entrar. Tente de novo em instantes.');
  });
});
