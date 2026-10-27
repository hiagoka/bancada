import { ApiError, NetworkError } from '../../api/http';

// Mensagens do login. 401 tem UMA mensagem só: e-mail inexistente e senha errada não se distinguem.
export function describeLoginError(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) return 'E-mail ou senha incorretos.';
  if (error instanceof ApiError && error.status === 429) {
    return 'Muitas tentativas. Aguarde um minuto e tente de novo.';
  }
  if (error instanceof NetworkError) {
    return 'A API está fora do ar. Verifique sua conexão e tente de novo.';
  }
  return 'Não foi possível entrar. Tente de novo em instantes.';
}
