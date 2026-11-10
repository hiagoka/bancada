import type { PublicOrder } from '@bancada/contracts';
import { useParams } from 'react-router';
import { ApiError, NetworkError } from '../../api/http';
import { Button, ButtonLink } from '../../components/Button';
import { formatDateTime } from '../../lib/format';
import { shortId } from '../../lib/shortId';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { OrderSummary } from './OrderSummary';
import { PixPayment } from './PixPayment';
import { OrderTracker } from './OrderTracker';
import { StatusPill } from './StatusPill';
import { statusAnnouncement } from './orderStatus';
import { isPaymentWindowOpen, paymentTarget } from './paymentTarget';
import { useOrder } from './useOrder';
import './orders.css';

function PaymentPanel({
  order,
  pollingStopped,
  onRefresh,
  onPixExpired,
}: {
  order: PublicOrder;
  pollingStopped: boolean;
  onRefresh: () => void;
  onPixExpired: () => Promise<unknown>;
}) {
  if (order.status === 'PAID') {
    return (
      <p className="order-panel order-panel--ok">
        <strong>Pagamento confirmado.</strong> Obrigado pela compra!
      </p>
    );
  }
  if (order.status === 'CANCELLED') {
    return (
      <div className="order-panel">
        <p>
          <strong>Este pedido foi cancelado.</strong> Isso acontece, por exemplo, quando o tempo
          para pagar acaba.
        </p>
        <ButtonLink to="/">Voltar ao catálogo</ButtonLink>
      </div>
    );
  }
  if (order.status === 'REFUNDED') {
    return (
      <p className="order-panel">
        <strong>O pagamento foi estornado.</strong>
      </p>
    );
  }

  // PENDING com Pix (AbacatePay, D34): QR Code, copia e cola e contagem. É o caminho de pagamento
  // do provedor real; o modo fake (sem pix) continua indo para o checkout simulado, abaixo.
  if (order.pix) {
    return (
      <>
        <PixPayment
          key={order.pix.expiresAt}
          orderId={order.id}
          pix={order.pix}
          onExpired={onPixExpired}
        />
        <p className="order-panel__hint">
          Acabou de pagar? A confirmação costuma levar poucos segundos. Não pague de novo.
        </p>
      </>
    );
  }

  // PENDING sem Pix
  // O destino SEMPRE passa pela mesma regra segura do checkout (http(s), sem credenciais).
  const target = paymentTarget(order.checkoutUrl, order.id, window.location.origin);
  const windowOpen = isPaymentWindowOpen(order.createdAt, Date.now());

  return (
    <div className="order-panel">
      {target && windowOpen ? (
        <>
          <p>
            <strong>Falta pagar.</strong> Abra o pagamento para confirmar o pedido.
          </p>
          {target.kind === 'internal' ? (
            <ButtonLink to={target.to}>Ir para o pagamento</ButtonLink>
          ) : (
            <a className="btn" href={target.url} rel="noopener noreferrer">
              Ir para o pagamento
            </a>
          )}
          <p className="order-panel__hint">
            Acabou de pagar? A confirmação pode levar alguns instantes. Não pague de novo.
          </p>
        </>
      ) : null}

      {target && !windowOpen ? (
        <>
          <p>
            <strong>O tempo para pagar acabou.</strong> O pagamento deste pedido expirou; em breve
            ele será cancelado.
          </p>
          <ButtonLink to="/">Voltar ao catálogo</ButtonLink>
        </>
      ) : null}

      {!target ? (
        <>
          <p>
            <strong>Estamos preparando o pagamento.</strong> Se demorar, volte ao carrinho e tente
            pagar de novo.
          </p>
          <ButtonLink variant="secondary" to="/carrinho">
            Voltar ao carrinho
          </ButtonLink>
        </>
      ) : null}

      {pollingStopped ? (
        <>
          <p>Ainda aguardando a confirmação do pagamento.</p>
          <Button variant="secondary" onClick={onRefresh}>
            Atualizar
          </Button>
        </>
      ) : null}
    </div>
  );
}

export function OrderPage() {
  const { id = '' } = useParams();
  // Nada de useSearchParams aqui, DE PROPÓSITO: provedores de pagamento podem voltar para cá com
  // status, payment_id... e o status do pedido só vale se vier da API (query string é forjável).
  const {
    data: order,
    error,
    isPending,
    isFetching,
    refetch,
    pollingStopped,
    restartPolling,
  } = useOrder(id);

  const notFound = error instanceof ApiError && error.status === 404;
  useDocumentTitle(order ? `Pedido #${shortId(order.id)}` : 'Pedido');

  return (
    <div className="container page order-page">
      {/* Região sempre montada: a troca de texto é anunciada (mudança de status). */}
      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {order ? statusAnnouncement(order.status) : isPending ? 'Carregando pedido…' : ''}
        {order && error ? ' Não foi possível atualizar agora. Tentando de novo.' : ''}
      </div>

      {isPending ? (
        <>
          <h1 className="page-title">Pedido</h1>
          <p aria-hidden="true">Carregando pedido…</p>
          <div className="order-skeleton" aria-hidden="true" />
        </>
      ) : null}

      {!order && error ? (
        <>
          <h1 className="page-title">{notFound ? 'Pedido não encontrado' : 'Pedido'}</h1>
          <div className="order-panel" role="alert">
            {notFound ? (
              <>
                <p>Confira o endereço ou volte ao catálogo.</p>
                <ButtonLink to="/">Voltar ao catálogo</ButtonLink>
              </>
            ) : (
              <>
                <p>
                  <strong>
                    {error instanceof NetworkError
                      ? 'A API está fora do ar.'
                      : 'Não foi possível carregar o pedido.'}
                  </strong>{' '}
                  {error instanceof NetworkError
                    ? 'Verifique sua conexão e tente de novo.'
                    : 'Tente de novo em instantes.'}
                </p>
                <Button onClick={() => void refetch()} aria-disabled={isFetching}>
                  {isFetching ? 'Tentando…' : 'Tentar de novo'}
                </Button>
              </>
            )}
          </div>
        </>
      ) : null}

      {order ? (
        <>
          <h1 className="page-title">
            Pedido <span className="mono">#{shortId(order.id)}</span>
          </h1>
          {error ? (
            <p className="order-panel__hint">Não foi possível atualizar agora. Tentando de novo.</p>
          ) : null}
          <StatusPill status={order.status} />
          <OrderTracker status={order.status} />
          <PaymentPanel
            order={order}
            pollingStopped={pollingStopped}
            onRefresh={restartPolling}
            onPixExpired={refetch}
          />
          <OrderSummary order={order} />
          <dl className="order-dates">
            <div>
              <dt>Criado em</dt>
              <dd className="mono">{formatDateTime(order.createdAt)}</dd>
            </div>
            {order.paidAt ? (
              <div>
                <dt>Pago em</dt>
                <dd className="mono">{formatDateTime(order.paidAt)}</dd>
              </div>
            ) : null}
          </dl>
          <p className="order-note">Guarde este endereço para acompanhar seu pedido.</p>
        </>
      ) : null}
    </div>
  );
}
