import type { Product } from '@bancada/contracts';
import { useAnnouncer } from '../../lib/announcer';
import { Button } from '../../components/Button';
import { maxQuantityFor, selectQuantityOf, useCartStore } from '../cart/cartStore';

export function AddToCartButton({ product }: { product: Product }) {
  const inCart = useCartStore(selectQuantityOf(product.id));
  const add = useCartStore((state) => state.add);
  const announce = useAnnouncer((state) => state.announce);

  if (product.stock < 1) {
    return (
      <Button disabled aria-label={`${product.name}: esgotado`}>
        Esgotado
      </Button>
    );
  }

  // No máximo, o botão usa aria-disabled (e não `disabled`): quem navega por teclado não perde o
  // foco no momento em que o último item entra, e o clique anuncia o motivo.
  if (inCart >= maxQuantityFor(product)) {
    return (
      <Button
        aria-disabled="true"
        aria-label={`${product.name}: máximo no carrinho`}
        onClick={() => announce(`${product.name}: máximo no carrinho.`)}
      >
        Máximo no carrinho
      </Button>
    );
  }

  return (
    <Button
      aria-label={`Adicionar ${product.name} ao carrinho`}
      onClick={() => {
        const added = add(product);
        if (added > 0) {
          const total = inCart + added;
          const atMax = total >= maxQuantityFor(product);
          announce(
            `${product.name} adicionado ao carrinho. ${total} no carrinho.${atMax ? ' Máximo atingido.' : ''}`,
          );
        }
      }}
    >
      Adicionar ao carrinho
    </Button>
  );
}
