import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { applyStockMovement } from '../modules/stock/stock.repository.js';
import { slugify } from '../shared/slug.js';
import { withTransaction } from './pool.js';

interface SeedProduct {
  name: string;
  slug: string;
  description: string;
  category: string;
  priceCents: number;
  stock: number;
}

function product(data: Omit<SeedProduct, 'slug'>): SeedProduct {
  return { ...data, slug: slugify(data.name) };
}

export const seedProducts: SeedProduct[] = [
  product({
    name: 'Teclado Mecânico 75%',
    description: 'Teclado mecânico compacto com switches marrons e hot-swap.',
    category: 'Teclados',
    priceCents: 59900,
    stock: 15,
  }),
  product({
    name: 'Mouse Sem Fio Ergonômico',
    description: 'Mouse vertical sem fio, 4000 DPI, bateria de até 6 meses.',
    category: 'Mouses',
    priceCents: 24900,
    stock: 20,
  }),
  product({
    name: 'Headset com Cancelamento de Ruído',
    description: 'Headset over-ear com microfone removível e cancelamento ativo de ruído.',
    category: 'Áudio',
    priceCents: 74900,
    stock: 8,
  }),
  product({
    name: 'Suporte de Monitor Articulado',
    description: 'Braço articulado de alumínio para monitores de até 32 polegadas.',
    category: 'Acessórios',
    priceCents: 38900,
    stock: 3,
  }),
  product({
    name: 'Hub USB-C 7 em 1',
    description: 'Hub com HDMI 4K, 3 USB-A, leitor SD e carregamento passthrough de 100W.',
    category: 'Acessórios',
    priceCents: 21900,
    stock: 12,
  }),
  product({
    name: 'Caneca Térmica Dev',
    description: 'Caneca térmica de 350 ml em aço inox para o café do deploy.',
    category: 'Casa',
    priceCents: 4900,
    stock: 30,
  }),
];

// Upsert por slug. O estoque só entra pelo movimento 'initial', e só quando o produto
// ainda não tem nenhum movimento: rodar de novo não duplica nem mexe no estoque atual.
export async function runSeed(pool: Pool, logger?: Logger): Promise<void> {
  for (const item of seedProducts) {
    await withTransaction(pool, async (client) => {
      // O upsert trava a linha, então seeds simultâneos se serializam aqui.
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO products (slug, name, description, category, price_cents, stock)
         VALUES ($1, $2, $3, $4, $5, 0)
         ON CONFLICT (slug) DO UPDATE
           SET name = EXCLUDED.name,
               description = EXCLUDED.description,
               category = EXCLUDED.category,
               price_cents = EXCLUDED.price_cents,
               updated_at = now()
         RETURNING id`,
        [item.slug, item.name, item.description, item.category, item.priceCents],
      );
      const productId = rows[0]!.id;

      const existing = await client.query(
        'SELECT 1 FROM stock_movements WHERE product_id = $1 LIMIT 1',
        [productId],
      );
      if (existing.rowCount === 0 && item.stock > 0) {
        await applyStockMovement(client, {
          productId,
          delta: item.stock,
          reason: 'initial',
          note: 'Estoque inicial (seed)',
        });
      }
    });
  }
  logger?.info({ products: seedProducts.length }, 'Seed concluído');
}
