import { useAnnouncer } from '../lib/announcer';

// Região aria-live polite (visualmente oculta) para "X adicionado ao carrinho" etc.
export function LiveRegion() {
  const message = useAnnouncer((state) => state.message);
  return (
    <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  );
}
