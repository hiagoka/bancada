import type { Db } from '../../db/pool.js';

export interface AdminRecord {
  id: string;
  email: string;
  name: string;
}

export interface AdminWithHash extends AdminRecord {
  passwordHash: string;
}

interface AdminRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
}

export async function findAdminByEmail(db: Db, email: string): Promise<AdminWithHash | null> {
  const { rows } = await db.query<AdminRow>(
    'SELECT id, email, name, password_hash FROM admins WHERE email = $1',
    [email],
  );
  const row = rows[0];
  return row
    ? { id: row.id, email: row.email, name: row.name, passwordHash: row.password_hash }
    : null;
}

// Sem o hash: é o que o requireAdmin carrega em req.admin.
export async function findAdminById(db: Db, id: string): Promise<AdminRecord | null> {
  const { rows } = await db.query<AdminRecord>('SELECT id, email, name FROM admins WHERE id = $1', [
    id,
  ]);
  return rows[0] ?? null;
}

// null = e-mail já cadastrado.
export async function insertAdmin(
  db: Db,
  admin: { email: string; passwordHash: string; name: string },
): Promise<AdminRecord | null> {
  const { rows } = await db.query<AdminRecord>(
    `INSERT INTO admins (email, password_hash, name) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO NOTHING
     RETURNING id, email, name`,
    [admin.email, admin.passwordHash, admin.name],
  );
  return rows[0] ?? null;
}
