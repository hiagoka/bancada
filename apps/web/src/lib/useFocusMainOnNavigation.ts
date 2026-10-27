import { useEffect, useRef, type RefObject } from 'react';
import { useLocation } from 'react-router';

// Navegação de SPA não recarrega a página: leitor de tela e teclado ficariam onde estavam.
// A cada troca de rota, volta ao topo e move o foco para o <main> (que tem tabIndex -1).
export function useFocusMainOnNavigation(mainRef: RefObject<HTMLElement | null>): void {
  const { pathname } = useLocation();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false; // a carga inicial não rouba o foco
      return;
    }
    window.scrollTo(0, 0);
    mainRef.current?.focus({ preventScroll: true });
  }, [pathname, mainRef]);
}
