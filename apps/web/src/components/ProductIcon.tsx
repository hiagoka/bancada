import { iconFor, type IconKind } from './iconFor';

// Ícones em traço (24x24, stroke currentColor), simples e próprios.
const PATHS: Record<IconKind, React.ReactNode> = {
  keyboard: (
    <>
      <rect x="2" y="6" width="20" height="12" />
      <path d="M5 9.5h1M8.5 9.5h1M12 9.5h1M15.5 9.5h1M18.5 9.5h.5M5 12.5h1M8.5 12.5h1M12 12.5h1M15.5 12.5h3.5M7 15.5h10" />
    </>
  ),
  mouse: (
    <>
      <rect x="6.5" y="2.5" width="11" height="19" rx="5.5" />
      <path d="M12 2.5v7M6.5 9.5h11" />
    </>
  ),
  headset: (
    <>
      <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
      <rect x="3" y="14" width="4" height="6" />
      <rect x="17" y="14" width="4" height="6" />
      <path d="M19 20c0 1.5-1.5 2-4 2" />
    </>
  ),
  stand: (
    <>
      <rect x="4" y="3" width="16" height="10" />
      <path d="M12 13v4M12 17l-4 4M12 17l4 4M7 21h10" />
    </>
  ),
  hub: (
    <>
      <rect x="3" y="8" width="18" height="8" />
      <path d="M6 11h3M12 11h3M17 11h1M6 13.5h12M3 12H1M23 12h-2" />
    </>
  ),
  mug: (
    <>
      <path d="M5 6h12v9a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5z" />
      <path d="M17 8h2a2 2 0 0 1 0 6h-2M8 2.5v1.5M11 2.5v1.5M14 2.5v1.5" />
    </>
  ),
  generic: (
    <>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" />
    </>
  ),
};

// Ícone da categoria sobre o fundo --mat quadriculado (grade fina de 16px, forte de 80px).
// Decorativo: aria-hidden. O nome do produto está no título do card.
export function ProductIcon({ category, name }: { category: string; name?: string }) {
  const kind = iconFor(category, name);
  return (
    <div className="product-icon" aria-hidden="true" data-icon={kind}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="square"
        strokeLinejoin="miter"
      >
        {PATHS[kind]}
      </svg>
    </div>
  );
}
