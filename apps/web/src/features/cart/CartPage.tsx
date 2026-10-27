import { useEffect } from 'react';
import { ButtonLink } from '../../components/Button';
import { formatPrice } from '../../lib/format';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { useProducts } from '../catalog/useProducts';
import { CartLine } from './CartLine';
import { selectSubtotalCents, selectTotalItems, useCartStore, type CartChange } from './cartStore';
import './cart.css';

export function noticeMessage(change: CartChange): string {
  switch (change.kind) {
    case 'reduced':
      return `Ajustamos a quantidade de ${change.productName} ao estoque disponível (${change.from} → ${change.to}).`;
    case 'out_of_stock':
      return `${change.productName} ficou sem estoque e saiu do carrinho.`;
    case 'removed':
      return `${change.productName} não está mais à venda e saiu do carrinho.`;
    case 'price_changed':
      return `O preço de ${change.productName} mudou de ${formatPrice(change.from ?? 0)} para ${formatPrice(change.to ?? 0)}.`;
  }
}

export function CartPage() {
  useDocumentTitle('Carrinho');
  const lines = useCartStore((state) => state.lines);
  const notices = useCartStore((state) => state.notices);
  const totalItems = useCartStore(selectTotalItems);
  const subtotal = useCartStore(selectSubtotalCents);
  const sync = useCartStore((state) => state.syncWithCatalog);
  const dismiss = useCartStore((state) => state.dismissNotices);
  const { data: products, isError } = useProducts({ refetchOnMount: 'always' });

  // Quando o catálogo chega, confere o carrinho com o estoque e os preços de agora.
  useEffect(() => {
    if (products) sync(products);
  }, [products, sync]);

  return (
    <div className="container page cart-page">
      <h1 className="page-title">Carrinho</h1>

      {/* Região sempre montada: só o conteúdo muda, então o leitor de tela anuncia os avisos. */}
      <div role="status" className="cart-status">
        {notices.length > 0 ? (
          <div className="cart-notices">
            <ul>
              {notices.map((change, index) => (
                <li key={`${change.productId}-${change.kind}-${index}`}>{noticeMessage(change)}</li>
              ))}
            </ul>
            <button type="button" className="link" onClick={dismiss}>
              Entendi
            </button>
          </div>
        ) : null}
        {isError && lines.length > 0 ? (
          <p className="cart-warning">
            Não foi possível conferir o estoque agora. Os valores abaixo podem estar desatualizados.
          </p>
        ) : null}
      </div>

      {lines.length === 0 ? (
        <div className="cart-empty">
          <p>Seu carrinho está vazio.</p>
          <ButtonLink to="/">Ver o catálogo</ButtonLink>
        </div>
      ) : (
        <>
          <ul className="cart-lines">
            {lines.map((line) => (
              <CartLine key={line.product.id} line={line} />
            ))}
          </ul>

          <dl className="cart-total">
            <div>
              <dt>Itens</dt>
              <dd className="mono">{totalItems}</dd>
            </div>
            <div>
              <dt>Total</dt>
              <dd className="price cart-total__value">{formatPrice(subtotal)}</dd>
            </div>
          </dl>

          {/* T15: o formulário de checkout (RHF + zodResolver) e o botão "Pagar R$ ..." entram AQUI.
              Nada de pedido é criado nesta tarefa. */}
          <section
            className="checkout-slot"
            aria-labelledby="checkout-slot-title"
            data-testid="checkout-slot"
          >
            <h2 id="checkout-slot-title">Finalizar compra</h2>
            <p className="muted">O formulário de pagamento chega na próxima etapa (T15).</p>
          </section>
        </>
      )}
    </div>
  );
}
