import { useState } from 'react';
import { ProductImage } from '../../components/ProductImage';
import { useAnnouncer } from '../../lib/announcer';
import { formatPrice } from '../../lib/format';
import { maxQuantityFor, useCartStore, type CartLine as CartLineData } from './cartStore';

// Uma linha do carrinho: imagem pequena, nome, preço unitário, quantidade (- / campo / +), remover
// e subtotal. Os limites vêm do estoque do snapshot do produto.
export function CartLine({ line, locked = false }: { line: CartLineData; locked?: boolean }) {
  const { product, quantity } = line;
  const setQuantity = useCartStore((state) => state.setQuantity);
  const remove = useCartStore((state) => state.remove);
  const announce = useAnnouncer((state) => state.announce);
  // Enquanto o usuário digita, o campo guarda o texto; confirma no blur/Enter.
  const [draft, setDraft] = useState<string | null>(null);

  const max = maxQuantityFor(product);

  // Muda a quantidade e anuncia o resultado (leitor de tela): o novo valor, o máximo ou a remoção.
  const change = (wanted: number) => {
    setQuantity(product.id, wanted);
    const after = useCartStore.getState().lines.find((l) => l.product.id === product.id);
    if (!after) announce(`${product.name} removido do carrinho.`);
    else if (wanted > max)
      announce(`Quantidade de ${product.name}: ${after.quantity}. Máximo atingido.`);
    else announce(`Quantidade de ${product.name}: ${after.quantity}.`);
  };

  const commit = () => {
    if (draft === null) return;
    const parsed = Number(draft);
    setDraft(null);
    if (draft.trim() === '' || !Number.isFinite(parsed)) return; // texto inválido: volta ao valor atual
    change(parsed);
  };

  return (
    <li className="cart-line">
      <ProductImage product={product} className="cart-line__image" decorative />
      <div className="cart-line__info">
        <h2 className="cart-line__name">{product.name}</h2>
        <p className="price cart-line__unit">{formatPrice(product.priceCents)} cada</p>
      </div>

      <div className="cart-line__qty" role="group" aria-label={`Quantidade de ${product.name}`}>
        <button
          type="button"
          className="qty-button"
          aria-label={`Diminuir quantidade de ${product.name}`}
          disabled={locked}
          aria-disabled={quantity <= 1}
          onClick={() => {
            if (quantity > 1) change(quantity - 1);
          }}
        >
          −
        </button>
        <input
          className="qty-input mono"
          type="number"
          inputMode="numeric"
          min={1}
          max={max}
          step={1}
          disabled={locked}
          aria-label={`Quantidade de ${product.name}`}
          value={draft ?? String(quantity)}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
          }}
        />
        <button
          type="button"
          className="qty-button"
          aria-label={`Aumentar quantidade de ${product.name}`}
          disabled={locked}
          aria-disabled={quantity >= max}
          onClick={() => {
            if (quantity < max) change(quantity + 1);
            else announce(`Quantidade de ${product.name}: ${quantity}. Máximo atingido.`);
          }}
        >
          +
        </button>
      </div>

      <p className="price cart-line__subtotal">{formatPrice(product.priceCents * quantity)}</p>

      <button
        type="button"
        className="cart-line__remove link"
        aria-label={`Remover ${product.name} do carrinho`}
        disabled={locked}
        onClick={() => {
          remove(product.id);
          announce(`${product.name} removido do carrinho.`);
        }}
      >
        Remover
      </button>
      {quantity >= max ? (
        <p className="cart-line__limit mono">Máximo disponível: {max} un.</p>
      ) : null}
    </li>
  );
}
