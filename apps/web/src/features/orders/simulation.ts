import type { PaymentStatus } from '@bancada/contracts';

// Para "Pagar valor diferente": total - R$ 10,00 se ainda sobrar pelo menos R$ 1,00; senão
// total + R$ 1,00. Sempre diferente do total (a API recusa o pagamento: amount_mismatch).
export function differentAmount(totalCents: number): number {
  return totalCents - 1000 >= 100 ? totalCents - 1000 : totalCents + 100;
}

export interface SimulationMessage {
  text: string;
  // Aprovar/cancelar com sucesso leva à página do pedido.
  goToOrder: boolean;
}

// Mensagem por (ação, outcome). Atenção: "rejected" não muda o pedido, então a API responde
// no_change: o que importa para o texto é a AÇÃO escolhida.
export function simulationMessage(action: PaymentStatus, outcome: string): SimulationMessage {
  if (action === 'rejected' && (outcome === 'no_change' || outcome === 'applied')) {
    return {
      text: 'Pagamento recusado. O pedido continua aguardando pagamento; você pode tentar de novo.',
      goToOrder: false,
    };
  }
  switch (outcome) {
    case 'applied':
      return action === 'cancelled'
        ? { text: 'Pedido cancelado.', goToOrder: true }
        : { text: 'Pagamento aprovado.', goToOrder: action === 'approved' };
    case 'amount_mismatch':
      return {
        text: 'O valor pago não confere com o pedido. O pagamento não foi aceito.',
        goToOrder: false,
      };
    case 'invalid_transition':
      return {
        text: 'Essa mudança não é permitida para o pedido neste momento.',
        goToOrder: false,
      };
    case 'no_change':
      return { text: 'Nada mudou: o pedido já estava nesse estado.', goToOrder: false };
    case 'duplicate':
      return { text: 'Esse pagamento já foi registrado antes.', goToOrder: false };
    case 'payment_not_found':
      return { text: 'O simulador não encontrou o pagamento.', goToOrder: false };
    case 'order_not_found':
      return { text: 'Pedido não encontrado.', goToOrder: false };
    default:
      return { text: `Resultado inesperado do simulador: ${outcome}.`, goToOrder: false };
  }
}
