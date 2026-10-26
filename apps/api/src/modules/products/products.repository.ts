import type { Db } from '../../db/pool.js';

export interface ProductRecord {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  priceCents: number;
  stock: number;
  active: boolean;
  imageKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ProductRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  price_cents: number;
  stock: number;
  active: boolean;
  image_key: string | null;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = `id, slug, name, description, category, price_cents, stock, active, image_key,
                 created_at, updated_at`;

function toRecord(row: ProductRow): ProductRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    category: row.category,
    priceCents: row.price_cents,
    stock: row.stock,
    active: row.active,
    imageKey: row.image_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listActiveProducts(db: Db): Promise<ProductRecord[]> {
  const { rows } = await db.query<ProductRow>(
    `SELECT ${COLUMNS} FROM products WHERE active ORDER BY lower(name), id`,
  );
  return rows.map(toRecord);
}

// `id` precisa ser um UUID válido (a rota valida antes), senão o pg lança 22P02.
export async function findActiveProductById(db: Db, id: string): Promise<ProductRecord | null> {
  const { rows } = await db.query<ProductRow>(
    `SELECT ${COLUMNS} FROM products WHERE id = $1 AND active`,
    [id],
  );
  return rows[0] ? toRecord(rows[0]) : null;
}
