import { useEffect } from 'react';

// Páginas do admin não devem ser indexadas: <meta name="robots" content="noindex"> enquanto montada.
export function useNoIndex(): void {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);
}
