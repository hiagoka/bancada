import { ApiError, NetworkError } from '../../api/http';

// Mensagens (PT-BR) para falhas ao salvar um produto.
export function describeSaveError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'SLUG_TAKEN')
      return 'Já existe um produto com esse nome. Escolha outro nome.';
    if (error.status === 404) return 'Produto não encontrado. Ele pode ter sido removido.';
    if (error.code === 'INVALID_FILE_TYPE') {
      return 'Tipo de imagem não permitido. Use JPEG, PNG ou WebP.';
    }
    if (error.code === 'VALIDATION_ERROR')
      return 'Confira os campos do formulário e tente de novo.';
  }
  if (error instanceof NetworkError) {
    return 'A API está fora do ar. Verifique sua conexão e tente de novo.';
  }
  return 'Não foi possível salvar o produto. Tente de novo em instantes.';
}
