import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

// Chave PÚBLICA da AbacatePay usada como chave do HMAC da assinatura dos webhooks. É a MESMA para
// todas as contas e está publicada na documentação oficial (constante ABACATEPAY_PUBLIC_KEY nos
// exemplos Node, Python e Go): https://docs.abacatepay.com/pages/notificacoes/seguranca
// Não é um segredo e NÃO tem relação com ABACATEPAY_WEBHOOK_SECRET (que prova a origem) nem com a
// chave de API: a assinatura só prova que o corpo chegou intacto.
export const ABACATEPAY_PUBLIC_KEY =
  't9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdiDkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9';

// Comparação em tempo constante e sem vazar o tamanho: compara os SHA-256 das duas entradas (que
// têm sempre 32 bytes), em vez de exigir tamanhos iguais antes do timingSafeEqual.
export function safeEqual(a: string, b: string): boolean {
  const digest = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();
  return timingSafeEqual(digest(a), digest(b));
}

// HMAC-SHA256 do corpo CRU (exatamente os bytes recebidos, antes de qualquer parse), em base64.
export function abacatePaySignature(rawBody: Buffer | string): string {
  return createHmac('sha256', ABACATEPAY_PUBLIC_KEY).update(rawBody).digest('base64');
}

export interface WebhookCredentials {
  rawBody: Buffer;
  // Header X-Webhook-Secret e header X-Webhook-Signature (ausentes = undefined).
  secretHeader: string | undefined;
  signatureHeader: string | undefined;
  // ABACATEPAY_WEBHOOK_SECRET.
  expectedSecret: string;
}

// As DUAS conferências precisam passar: o secret prova a origem e a assinatura prova que o corpo
// não foi alterado. As duas são sempre avaliadas (sem curto-circuito) para o tempo de resposta não
// revelar qual falhou.
export function verifyAbacatePayWebhook({
  rawBody,
  secretHeader,
  signatureHeader,
  expectedSecret,
}: WebhookCredentials): boolean {
  if (expectedSecret === '') return false; // configuração ausente: falha fechada
  const secretOk = safeEqual(secretHeader ?? '', expectedSecret) && secretHeader !== undefined;
  const signatureOk =
    safeEqual(signatureHeader ?? '', abacatePaySignature(rawBody)) && signatureHeader !== undefined;
  return secretOk && signatureOk;
}
