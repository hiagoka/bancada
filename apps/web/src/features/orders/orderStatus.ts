import type { OrderStatus } from '@bancada/contracts';

export const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: 'Aguardando pagamento',
  PAID: 'Pago',
  CANCELLED: 'Cancelado',
  REFUNDED: 'Estornado',
};

// Texto lido pelo leitor de tela (região aria-live) quando o status muda.
export function statusAnnouncement(status: OrderStatus): string {
  switch (status) {
    case 'PENDING':
      return 'Pedido aguardando pagamento.';
    case 'PAID':
      return 'Pagamento confirmado. Seu pedido está pago.';
    case 'CANCELLED':
      return 'Este pedido foi cancelado.';
    case 'REFUNDED':
      return 'O pagamento deste pedido foi estornado.';
  }
}

export type StepState = 'done' | 'current' | 'upcoming' | 'failed';

export interface TrackerStep {
  label: string;
  state: StepState;
  // Texto do estado (não depende de cor: aparece escrito e vai para o leitor de tela).
  stateText: string;
  note?: string;
}

const STATE_TEXT: Record<StepState, string> = {
  done: 'Concluído',
  current: 'Em andamento',
  upcoming: 'Pendente',
  failed: 'Não ocorreu',
};

const step = (label: string, state: StepState, note?: string): TrackerStep => ({
  label,
  state,
  stateText: STATE_TEXT[state],
  ...(note ? { note } : {}),
});

// Pedido recebido -> Pagamento -> Confirmado.
export function trackerSteps(status: OrderStatus): TrackerStep[] {
  switch (status) {
    case 'PENDING':
      return [
        step('Pedido recebido', 'done'),
        step('Pagamento', 'current'),
        step('Confirmado', 'upcoming'),
      ];
    case 'PAID':
      // Pedido pago e confirmado: tudo concluído (nada "em andamento").
      return [
        step('Pedido recebido', 'done'),
        step('Pagamento', 'done'),
        step('Confirmado', 'done'),
      ];
    case 'CANCELLED':
      return [
        step('Pedido recebido', 'done'),
        step('Pagamento', 'failed'),
        step('Confirmado', 'upcoming'),
      ];
    case 'REFUNDED':
      return [
        step('Pedido recebido', 'done'),
        step('Pagamento', 'done'),
        step('Confirmado', 'done', 'Estornado'),
      ];
  }
}
