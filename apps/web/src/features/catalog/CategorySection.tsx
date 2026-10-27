import { ProductCard } from './ProductCard';
import type { CategoryGroup } from './groupByCategory';

// Divisor de categoria (faixa entre bordas ink, nome em mat) + grade assimétrica de 12 colunas.
export function CategorySection({ group, index }: { group: CategoryGroup; index: number }) {
  const headingId = `categoria-${index}`;
  return (
    <section aria-labelledby={headingId} className="category">
      <h2 id={headingId} className="category-divider">
        <span className="category-divider__inner container">{group.category}</span>
      </h2>
      <ul className="container product-grid">
        {group.products.map((product) => (
          <li key={product.id} className="product-grid__item">
            <ProductCard product={product} />
          </li>
        ))}
      </ul>
    </section>
  );
}
