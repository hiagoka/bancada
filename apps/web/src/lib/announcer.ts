import { create } from 'zustand';

interface AnnouncerState {
  message: string;
  announce: (message: string) => void;
}

// Quanto tempo a mensagem fica na região aria-live. Depois disso é limpa: a região é global (fica
// montada ao trocar de página), e uma mensagem velha como "Criando seu pedido…" não pode ser relida
// fora de contexto na página seguinte.
export const ANNOUNCEMENT_LIFETIME_MS = 2000;

let clearTimer: ReturnType<typeof setTimeout> | undefined;

// Mensagem para a região aria-live (leitores de tela). Repetir o mesmo texto precisa mudar o
// conteúdo para ser anunciado de novo: alterna um espaço não separável no fim.
export const useAnnouncer = create<AnnouncerState>((set, get) => ({
  message: '',
  announce: (message) => {
    const next = get().message === message ? `${message}\u00a0` : message;
    set({ message: next });
    // Cada anúncio reinicia o prazo e só apaga a PRÓPRIA mensagem (nunca a de um anúncio mais novo).
    clearTimeout(clearTimer);
    clearTimer = setTimeout(() => {
      if (get().message === next) set({ message: '' });
      clearTimer = undefined;
    }, ANNOUNCEMENT_LIFETIME_MS);
  },
}));
