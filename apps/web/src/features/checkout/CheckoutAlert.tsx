import { useEffect, useRef } from 'react';
import { Button } from '../../components/Button';
import type { CheckoutFailure } from './checkoutErrors';

interface Props {
  failure: CheckoutFailure;
  // Muda a cada falha (mesmo tipo de erro duas vezes seguidas): reanuncia e leva o foco de novo.
  attempt: number;
  onAdjustStock: () => void;
  onRemoveUnavailable: () => void;
  onRefreshStock: () => void;
}

// Região role="alert" (anunciada na hora) que recebe o foco. Mensagens em PT-BR.
export function CheckoutAlert({
  failure,
  attempt,
  onAdjustStock,
  onRemoveUnavailable,
  onRefreshStock,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [attempt]);

  return (
    <div ref={ref} role="alert" tabIndex={-1} className="checkout-alert" data-kind={failure.kind}>
      {failure.kind === 'out_of_stock' ? (
        <>
          <p className="checkout-alert__title">Alguns itens não têm estoque suficiente.</p>
          {failure.items.length > 0 ? (
            <>
              <ul>
                {failure.items.map((item) => (
                  <li key={item.productId}>
                    <strong>{item.name}</strong>: pediu {item.requested}, restam {item.available}
                  </li>
                ))}
              </ul>
              <Button onClick={onAdjustStock}>Ajustar ao estoque disponível</Button>
            </>
          ) : (
            <Button onClick={onRefreshStock}>Conferir estoque</Button>
          )}
        </>
      ) : null}

      {failure.kind === 'unavailable' ? (
        <>
          <p className="checkout-alert__title">Alguns itens saíram do catálogo.</p>
          {failure.items.length > 0 ? (
            <ul>
              {failure.items.map((item) => (
                <li key={item.productId}>
                  <strong>{item.name}</strong> não está mais disponível
                </li>
              ))}
            </ul>
          ) : null}
          <Button onClick={onRemoveUnavailable}>Remover itens indisponíveis</Button>
        </>
      ) : null}

      {failure.kind === 'checkout_unavailable' ? (
        <p className="checkout-alert__title">
          {failure.expired
            ? 'O tempo para pagar este pedido acabou. Vamos criar um novo pedido.'
            : 'O pagamento não abriu, mas seu pedido está reservado. Tente pagar de novo.'}
        </p>
      ) : null}

      {failure.kind === 'closed' ? (
        <p className="checkout-alert__title">
          Esse pedido já foi encerrado. Confira os dados e tente de novo.
        </p>
      ) : null}

      {failure.kind === 'reused' ? (
        <p className="checkout-alert__title">Não foi possível concluir o pedido. Tente de novo.</p>
      ) : null}

      {failure.kind === 'validation' ? (
        <>
          <p className="checkout-alert__title">Não conseguimos criar o pedido.</p>
          <ul>
            {failure.messages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </>
      ) : null}

      {failure.kind === 'network' ? (
        <p className="checkout-alert__title">A API está fora do ar. Tente de novo em instantes.</p>
      ) : null}

      {failure.kind === 'generic' ? (
        <p className="checkout-alert__title">Algo deu errado ao criar o pedido. Tente de novo.</p>
      ) : null}
    </div>
  );
}
