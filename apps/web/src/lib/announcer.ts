import { create } from 'zustand';

interface AnnouncerState {
  message: string;
  announce: (message: string) => void;
}

// Mensagem para a região aria-live (leitores de tela). Repetir o mesmo texto precisa mudar o
// conteúdo para ser anunciado de novo: alterna um espaço não separável no fim.
export const useAnnouncer = create<AnnouncerState>((set, get) => ({
  message: '',
  announce: (message) => set({ message: get().message === message ? `${message}\u00a0` : message }),
}));
