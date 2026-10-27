import type { Product } from '@bancada/contracts';
import { ProductImage } from '../../components/ProductImage';
import { formatPrice } from '../../lib/format';
import { AddToCartButton } from './AddToCartButton';
import { StatusBadge } from './StatusBadge';
import './catalog.css';

export function ProductCard({ product }: { product: Product }) {
  return (
    <article className="product-card">
      <div className="product-card__media">
        <ProductImage product={product} decorative />
        <StatusBadge stock={product.stock} />
      </div>
      <div className="product-card__body">
        <h3 className="product-card__title">{product.name}</h3>
        <p className="price product-card__price">{formatPrice(product.priceCents)}</p>
      </div>
      <AddToCartButton product={product} />
    </article>
  );
}
