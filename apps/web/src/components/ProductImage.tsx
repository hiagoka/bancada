import { useState } from 'react';
import type { Product } from '@bancada/contracts';
import { ProductIcon } from './ProductIcon';
import './product.css';

type Media = Pick<Product, 'name' | 'category' | 'imageUrl'>;

// Imagem do produto em escala de cinza e alto contraste. Sem imagem, ou se ela falhar ao carregar
// (onError), mostra o ícone da categoria.
export function ProductImage({
  product,
  className,
  decorative = false,
}: {
  product: Media;
  className?: string;
  // true quando o nome do produto já está escrito ao lado (card, linha do carrinho): alt vazio
  // evita o leitor de tela ler o nome duas vezes.
  decorative?: boolean;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = product.imageUrl !== null && product.imageUrl !== failedUrl;
  return (
    <div className={['product-image', className].filter(Boolean).join(' ')}>
      {showImage ? (
        <img
          className="product-image__img"
          src={product.imageUrl ?? undefined}
          alt={decorative ? '' : product.name}
          loading="lazy"
          decoding="async"
          onError={() => setFailedUrl(product.imageUrl)}
        />
      ) : (
        <ProductIcon category={product.category} name={product.name} />
      )}
    </div>
  );
}
