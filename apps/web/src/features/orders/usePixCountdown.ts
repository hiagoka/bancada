import { useEffect, useRef, useState } from 'react';
import { serverNow } from '../../lib/serverClock';

const ANNOUNCE_AT_SECONDS = 10;

// mm:ss (60:00 no máximo de uma hora inteira; abaixo de zero vira 00:00).
export function formatCountdown(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

// Segundos até `expiresAt`, no relógio do SERVIDOR (serverNow), arredondando para cima.
function remainingFrom(expiresAtMs: number): number {
  return Math.max(0, Math.ceil((expiresAtMs - serverNow()) / 1000));
}

const minutesLabel = (m: number): string => `${m} ${m === 1 ? 'minuto' : 'minutos'}`;

// Contagem regressiva do Pix. A cada tick o restante é RECALCULADO do relógio (não decrementado
// às cegas), então uma aba em segundo plano ou um aparelho que dormiu não atrasam a contagem.
//
// Anúncio para leitor de tela (`announcement`, para uma região aria-live): NUNCA a cada segundo.
// Só (a) quando vira um minuto, (b) uma vez nos últimos 10 s e (c) quando o tempo acaba.
export function usePixCountdown(expiresAt: string) {
  const expiresAtMs = Date.parse(expiresAt);
  const [remainingSeconds, setRemainingSeconds] = useState(() => remainingFrom(expiresAtMs));
  const [announcement, setAnnouncement] = useState('');
  const progress = useRef({ minutes: Number.POSITIVE_INFINITY, tenSeconds: false, ended: false });

  // Reinicia a conta quando muda a validade (outro pedido na mesma tela).
  const [trackedExpiry, setTrackedExpiry] = useState(expiresAtMs);
  if (trackedExpiry !== expiresAtMs) {
    setTrackedExpiry(expiresAtMs);
    setRemainingSeconds(remainingFrom(expiresAtMs));
    setAnnouncement('');
    progress.current = { minutes: Number.POSITIVE_INFINITY, tenSeconds: false, ended: false };
  }

  useEffect(() => {
    const evaluate = (): void => {
      const remaining = remainingFrom(expiresAtMs);
      setRemainingSeconds(remaining);
      const state = progress.current;
      if (remaining <= 0) {
        if (!state.ended) {
          state.ended = true;
          setAnnouncement('O tempo para pagar o Pix acabou.');
        }
        return;
      }
      if (remaining <= ANNOUNCE_AT_SECONDS) {
        if (!state.tenSeconds) {
          state.tenSeconds = true;
          setAnnouncement(`Faltam ${ANNOUNCE_AT_SECONDS} segundos para o Pix expirar.`);
        }
        return;
      }
      const minutes = Math.ceil(remaining / 60);
      if (state.minutes === Number.POSITIVE_INFINITY) {
        state.minutes = minutes; // primeira leitura: só guarda (nada de anúncio ao montar)
      } else if (minutes < state.minutes) {
        state.minutes = minutes;
        setAnnouncement(`Faltam ${minutesLabel(minutes)} para o Pix expirar.`);
      }
    };
    evaluate();
    const timer = setInterval(evaluate, 1000);
    return () => clearInterval(timer);
  }, [expiresAtMs]);

  return {
    remainingSeconds,
    display: formatCountdown(remainingSeconds),
    expired: remainingSeconds <= 0,
    announcement,
  };
}
