// Relógio do SERVIDOR, para a contagem regressiva do Pix. A validade (pix.expiresAt) é um instante do
// relógio do servidor; comparar com o relógio do aparelho erra pelo atraso ou adiantamento dele (um
// celular com 3 minutos de diferença mostraria o Pix vencido, ou vivo, na hora errada).
// Toda resposta da API com header Date reajusta a diferença; sem Date legível (por exemplo, o CORS
// não expôs o header), a diferença é 0 e vale o relógio local.
let offsetMs = 0;
// RTT da resposta que acertou o relógio e quando isso aconteceu (para preferir o menor RTT).
let bestRttMs = Number.POSITIVE_INFINITY;
let bestAt = 0;

// O header Date tem resolução de 1 s (o servidor trunca): somar meio segundo centraliza o erro.
const HALF_SECOND_MS = 500;
// Resposta que passou mais que isto num cache compartilhado (header Age) traz um Date velho.
const MAX_AGE_SECONDS = 5;
// Depois disto a estimativa é renovada mesmo com RTT pior (o relógio do aparelho anda).
const REFRESH_AFTER_MS = 60_000;

export interface ServerDateInfo {
  // Header Age da resposta (segundos), se houver.
  age?: string | null;
  // Tempo entre enviar a requisição e receber os headers (ms).
  rttMs?: number;
}

// Acerta o relógio com o header Date de uma resposta. Ignora respostas de cache (Age > 5 s) e, entre
// as demais, prefere a de menor RTT (a menos que a estimativa tenha mais de 60 s).
export function recordServerDate(header: string | null, info: ServerDateInfo = {}): void {
  if (!header) return;
  const serverMs = Date.parse(header);
  if (Number.isNaN(serverMs)) return;
  const age = Number(info.age);
  if (info.age && Number.isFinite(age) && age > MAX_AGE_SECONDS) return;

  const rtt = Math.max(0, info.rttMs ?? 0);
  const now = Date.now();
  if (rtt > bestRttMs && now - bestAt < REFRESH_AFTER_MS) return;

  bestRttMs = rtt;
  bestAt = now;
  // O Date foi gerado quando o servidor ENVIOU: no instante em que a resposta chegou, já passou
  // aproximadamente metade do RTT.
  offsetMs = serverMs + HALF_SECOND_MS + rtt / 2 - now;
}

// Agora, no relógio do servidor (ms desde a época).
export function serverNow(): number {
  return Date.now() + offsetMs;
}

export function resetServerClock(): void {
  offsetMs = 0;
  bestRttMs = Number.POSITIVE_INFINITY;
  bestAt = 0;
}
