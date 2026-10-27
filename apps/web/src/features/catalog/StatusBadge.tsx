import { stockBadge } from './stockBadge';

// Selo de status (D25): retângulo sem raio, fundo tape, texto 10px negrito maiúsculo em ink,
// no canto superior direito. Desktop: aparece no hover/foco; sem hover: sempre visível.
// O texto fica no DOM o tempo todo (leitores de tela leem mesmo com opacity 0).
export function StatusBadge({ stock }: { stock: number }) {
  const label = stockBadge(stock);
  if (!label) return null;
  return <span className="status-badge">{label}</span>;
}
