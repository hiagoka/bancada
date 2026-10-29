import { describe, expect, it } from 'vitest';
import { ApiError, NetworkError } from '../../api/http';
import { describeSaveError } from './productSaveError';

describe('describeSaveError', () => {
  it.each([
    [
      new ApiError(409, 'SLUG_TAKEN', 'x'),
      'Já existe um produto com esse nome. Escolha outro nome.',
    ],
    [new ApiError(404, 'NOT_FOUND', 'x'), 'Produto não encontrado. Ele pode ter sido removido.'],
    [
      new ApiError(400, 'VALIDATION_ERROR', 'x'),
      'Confira os campos do formulário e tente de novo.',
    ],
    [
      new ApiError(400, 'INVALID_FILE_TYPE', 'x'),
      'Tipo de imagem não permitido. Use JPEG, PNG ou WebP.',
    ],
    [new NetworkError(), 'A API está fora do ar. Verifique sua conexão e tente de novo.'],
    [
      new ApiError(500, 'INTERNAL_ERROR', 'x'),
      'Não foi possível salvar o produto. Tente de novo em instantes.',
    ],
    [new Error('boom'), 'Não foi possível salvar o produto. Tente de novo em instantes.'],
  ])('%s', (error, message) => {
    expect(describeSaveError(error)).toBe(message);
  });
});
