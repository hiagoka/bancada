// Relógio do SERVIDOR, para a contagem regressiva do Pix. A validade (pix.expiresAt) é um instante do
// relógio do servidor; comparar com o relógio do aparelho erra pelo atraso ou adiantamento dele (um
// celular com 3 minutos de diferença mostraria o Pix vencido, ou vivo, na hora errada).
// Toda resposta da API com header Date reajusta a diferença; sem Date legível (por exemplo, o CORS
// não expôs o header), a diferença é 0 e vale o relógio local.
let offsetMs = 0;

// O header Date tem resolução de 1 s (o servidor trunca): somar meio segundo centraliza o erro.
const HALF_SECOND_MS = 500;

export function recordServerDate(header: string | null): void {
  if (!header) return;
  const serverMs = Date.parse(header);
  if (Number.isNaN(serverMs)) return;
  offsetMs = serverMs + HALF_SECOND_MS - Date.now();
}

// Agora, no relógio do servidor (ms desde a época).
export function serverNow(): number {
  return Date.now() + offsetMs;
}

export function resetServerClock(): void {
  offsetMs = 0;
}
