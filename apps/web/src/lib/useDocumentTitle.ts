import { useEffect } from 'react';

// Título da aba por rota (leitores de tela anunciam a mudança de página).
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title === 'Bancada' ? title : `${title} · Bancada`;
  }, [title]);
}
