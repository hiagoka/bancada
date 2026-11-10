import { orderStatusSchema, type Order } from '@bancada/contracts';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ApiError, NetworkError } from '../../api/http';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { formatDateTime, formatPrice } from '../../lib/format';
import { shortId } from '../../lib/shortId';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { STATUS_LABEL } from '../orders/orderStatus';
import { StatusPill } from '../orders/StatusPill';
import { FormAlert } from './FormAlert';
import { ordersHref, parseOrdersParams } from './ordersParams';
import { describeCancelError, useAdminOrders, useCancelOrder } from './useAdminOrders';
import '../orders/orders.css';
import './admin-products.css';

export function OrdersListPage() {
  useDocumentTitle('Pedidos');
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = parseOrdersParams(searchParams);
  const { data, error, isPending, isFetching, refetch } = useAdminOrders(filters);
  const cancel = useCancelOrder();

  const [target, setTarget] = useState<Order | null>(null);
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState<{ message: string; attempt: number } | null>(null);
  const failureCount = useRef(0);
  const busy = useRef(false);
  const noticeRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (notice) noticeRef.current?.focus(); // o botão clicado some da lista: o foco não se perde
  }, [notice]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const changeStatus = (value: string): void => {
    const status = orderStatusSchema.safeParse(value);
    const next = new URLSearchParams();
    if (status.success) next.set('status', status.data);
    setSearchParams(next); // trocar o filtro volta à página 1
  };

  const confirmCancel = async (): Promise<void> => {
    if (!target || busy.current) return;
    busy.current = true;
    const order = target;
    setNotice('');
    setFailure(null);
    try {
      await cancel.mutateAsync(order.id);
      setNotice(`Pedido #${shortId(order.id)} cancelado. O estoque dos itens voltou para a loja.`);
    } catch (caught) {
      failureCount.current += 1;
      setFailure({ message: describeCancelError(caught), attempt: failureCount.current });
    } finally {
      setTarget(null);
      busy.current = false;
    }
  };

  const count = data?.total ?? 0;

  return (
    <div className="container page admin-products">
      <h1 className="page-title">Pedidos</h1>

      <div className="admin-products__filters" role="search">
        <div className="field">
          <label htmlFor="orders-status">Situação</label>
          <select
            id="orders-status"
            value={filters.status}
            onChange={(event) => changeStatus(event.target.value)}
          >
            <option value="all">Todos</option>
            {orderStatusSchema.options.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABEL[status]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p role="status" className="admin-products__count">
        {data
          ? `${count} ${count === 1 ? 'pedido' : 'pedidos'} · página ${data.page} de ${totalPages}`
          : ''}
        {isPending ? 'Carregando pedidos…' : ''}
      </p>
      <p
        role="status"
        ref={noticeRef}
        tabIndex={-1}
        className={notice ? 'admin-notice' : 'visually-hidden'}
      >
        {notice}
      </p>

      {failure ? <FormAlert message={failure.message} attempt={failure.attempt} /> : null}

      {error && !data ? (
        <div role="alert" className="login-alert">
          <p>
            <strong>
              {error instanceof NetworkError
                ? 'A API está fora do ar.'
                : error instanceof ApiError && error.status === 401
                  ? 'Sua sessão terminou.'
                  : 'Não foi possível carregar os pedidos.'}
            </strong>{' '}
            Tente de novo em instantes.
          </p>
          <Button onClick={() => void refetch()} aria-disabled={isFetching}>
            {isFetching ? 'Tentando…' : 'Tentar de novo'}
          </Button>
        </div>
      ) : null}

      {data && data.items.length === 0 ? (
        data.page > 1 ? (
          <p>
            Nenhum pedido nesta página.{' '}
            <Link className="link" to={ordersHref({ status: filters.status, page: 1 })}>
              Ir para a primeira página
            </Link>
          </p>
        ) : (
          <p>{filters.status !== 'all' ? 'Nenhum pedido encontrado.' : 'Ainda não há pedidos.'}</p>
        )
      ) : null}

      {data && data.items.length > 0 ? (
        <table className="admin-table">
          <thead>
            <tr>
              <th scope="col">Pedido</th>
              <th scope="col">Data</th>
              <th scope="col">Cliente</th>
              <th scope="col">Itens</th>
              <th scope="col" className="num">
                Total
              </th>
              <th scope="col">Situação</th>
              <th scope="col">Ação</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((order) => (
              <tr key={order.id}>
                <td data-label="Pedido" className="mono">
                  #{shortId(order.id)}
                </td>
                <td data-label="Data" className="mono">
                  {formatDateTime(order.createdAt)}
                </td>
                <td data-label="Cliente">
                  <span className="admin-table__name">{order.customer.name}</span>
                  <br />
                  <span className="mono admin-table__email">{order.customer.email}</span>
                </td>
                <td data-label="Itens">
                  <ul className="admin-table__items">
                    {order.items.map((item) => (
                      <li key={item.productId}>
                        <span className="mono">{item.quantity} ×</span> {item.productName}
                      </li>
                    ))}
                  </ul>
                </td>
                <td data-label="Total" className="num mono">
                  {formatPrice(order.totalCents)}
                </td>
                <td data-label="Situação">
                  <StatusPill status={order.status} compact />
                </td>
                <td data-label="Ação">
                  {order.cancellable ? (
                    <Button
                      variant="secondary"
                      aria-label={`Cancelar pedido #${shortId(order.id)}`}
                      onClick={() => setTarget(order)}
                    >
                      Cancelar pedido
                    </Button>
                  ) : (
                    <span aria-hidden="true">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {data && data.total > 0 ? (
        <nav className="admin-pagination" aria-label="Paginação">
          {data.page > 1 ? (
            <Link
              className="btn btn--secondary"
              to={ordersHref({ status: filters.status, page: data.page - 1 })}
            >
              Anterior
            </Link>
          ) : (
            <span className="btn btn--secondary" aria-disabled="true">
              Anterior
            </span>
          )}
          <span className="mono">
            {data.page} / {totalPages}
          </span>
          {data.page < totalPages ? (
            <Link
              className="btn btn--secondary"
              to={ordersHref({ status: filters.status, page: data.page + 1 })}
            >
              Próxima
            </Link>
          ) : (
            <span className="btn btn--secondary" aria-disabled="true">
              Próxima
            </span>
          )}
        </nav>
      ) : null}

      <ConfirmDialog
        open={target !== null}
        title={target ? `Cancelar o pedido #${shortId(target.id)}?` : ''}
        description={
          target
            ? `Total ${formatPrice(target.totalCents)}. O estoque dos itens volta para a loja. Não dá para desfazer.`
            : ''
        }
        confirmLabel="Cancelar pedido"
        cancelLabel="Voltar"
        busy={cancel.isPending}
        onConfirm={() => void confirmCancel()}
        onCancel={() => setTarget(null)}
      />
    </div>
  );
}
