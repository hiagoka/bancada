import type { PaymentStatus } from '@bancada/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { simulatePayment } from '../../api/dev';
import { ApiError, NetworkError } from '../../api/http';
import { Button, ButtonLink } from '../../components/Button';
import { formatPrice } from '../../lib/format';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { PRODUCTS_QUERY_KEY } from '../catalog/useProducts';
import { OrderSummary } from './OrderSummary';
import { StatusPill } from './StatusPill';
import { shortId } from '../../lib/shortId';
import { differentAmount, simulationMessage } from './simulation';
import { orderQueryKey, useOrder } from './useOrder';
import './orders.css';

interface Action {
  id: string;
  label: string;
  status: PaymentStatus;
  amountCents?: number;
  hint?: string;
}

function failureText(error: unknown): { text: string; simulatorOff: boolean } {
  if (error instanceof ApiError && error.status === 404) {
    return { text: 'O modo simulado não está ativo neste ambiente.', simulatorOff: true };
  }
  if (error instanceof NetworkError) {
    return { text: 'A API está fora do ar. Tente de novo em instantes.', simulatorOff: false };
  }
  return { text: 'Não foi possível simular o pagamento. Tente de novo.', simulatorOff: false };
}

// Substitui o Mercado Pago no modo fake: cada botão chama POST /dev/payments/simulate, que passa
// pelo MESMO tratamento do webhook real.
export function FakeCheckoutPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: order, error, isPending, refetch } = useOrder(id);
  const [result, setResult] = useState<{ text: string; simulatorOff: boolean } | null>(null);
  const busy = useRef(false); // guarda imediata contra clique duplo (o aria-disabled só vale no re-render)

  useDocumentTitle(order ? `Checkout simulado #${shortId(order.id)}` : 'Checkout simulado');

  const mutation = useMutation({
    retry: false,
    mutationFn: (action: Action) =>
      simulatePayment({ orderId: id, status: action.status, amountCents: action.amountCents }),
    // Depois de CADA chamada (sucesso ou erro): o pedido e o estoque podem ter mudado.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: orderQueryKey(id) });
      void queryClient.invalidateQueries({ queryKey: PRODUCTS_QUERY_KEY });
    },
  });

  const isPendingOrder = order?.status === 'PENDING';
  const locked = mutation.isPending || !isPendingOrder;

  const actions: Action[] = order
    ? [
        { id: 'approve', label: 'Aprovar pagamento', status: 'approved' },
        { id: 'reject', label: 'Recusar pagamento', status: 'rejected' },
        { id: 'cancel', label: 'Cancelar pedido', status: 'cancelled' },
        {
          id: 'different',
          label: 'Pagar valor diferente',
          status: 'approved',
          amountCents: differentAmount(order.totalCents),
          hint: `Paga ${formatPrice(differentAmount(order.totalCents))} em vez de ${formatPrice(order.totalCents)}: testa a proteção contra valor adulterado.`,
        },
      ]
    : [];

  const run = async (action: Action): Promise<void> => {
    if (busy.current || locked) return;
    busy.current = true;
    setResult(null);
    try {
      const { outcome } = await mutation.mutateAsync(action);
      const message = simulationMessage(action.status, outcome);
      setResult({ text: message.text, simulatorOff: false });
      if (message.goToOrder) navigate(`/pedido/${id}`);
    } catch (err) {
      setResult(failureText(err));
    } finally {
      busy.current = false;
    }
  };

  const notFound = error instanceof ApiError && error.status === 404;

  return (
    <>
      <div className="sim-banner on-mat" role="note">
        <div className="container">
          <strong>MODO SIMULADO:</strong> nenhum dinheiro real é cobrado
        </div>
      </div>

      <div className="container page order-page">
        <h1 className="page-title">Checkout simulado</h1>

        {isPending ? <p>Carregando pedido…</p> : null}

        {!order && error ? (
          <div className="order-panel" role="alert">
            <p>
              <strong>
                {notFound
                  ? 'Pedido não encontrado.'
                  : error instanceof NetworkError
                    ? 'A API está fora do ar.'
                    : 'Não foi possível carregar o pedido.'}
              </strong>
            </p>
            {notFound ? (
              <ButtonLink to="/">Voltar ao catálogo</ButtonLink>
            ) : (
              <Button onClick={() => void refetch()}>Tentar de novo</Button>
            )}
          </div>
        ) : null}

        {order ? (
          <>
            <p className="mono order-page__id">Pedido #{shortId(order.id)}</p>
            <OrderSummary order={order} />

            {!isPendingOrder ? (
              <div className="order-panel">
                <StatusPill status={order.status} />
                <p>Este pedido não está mais aguardando pagamento: a simulação está desativada.</p>
                <ButtonLink to={`/pedido/${order.id}`}>Ver pedido</ButtonLink>
              </div>
            ) : null}

            <section className="sim-actions" aria-labelledby="sim-actions-title">
              <h2 id="sim-actions-title">Simular o pagamento</h2>
              <ul>
                {actions.map((action) => (
                  <li key={action.id}>
                    <Button
                      aria-disabled={locked}
                      variant={action.id === 'approve' ? 'primary' : 'secondary'}
                      onClick={() => void run(action)}
                    >
                      {action.label}
                    </Button>
                    {action.hint ? <p className="sim-actions__hint">{action.hint}</p> : null}
                  </li>
                ))}
              </ul>
            </section>
          </>
        ) : null}

        {/* Região sempre montada: o resultado de cada simulação é anunciado. */}
        <div className="sim-result" role="status" aria-live="polite">
          {result ? (
            <>
              <p>{result.text}</p>
              {result.simulatorOff ? <Link to={`/pedido/${id}`}>Ver pedido</Link> : null}
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
