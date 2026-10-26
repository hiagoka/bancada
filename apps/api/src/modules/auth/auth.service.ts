import { compare, hash } from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Pool } from 'pg';
import { z } from 'zod';
import { AppError } from '../../shared/errors.js';
import {
  findAdminByEmail,
  findAdminById,
  insertAdmin,
  type AdminRecord,
} from './admins.repository.js';

export const TOKEN_TTL_SECONDS = 8 * 60 * 60;
export const BCRYPT_COST_PRODUCTION = 12;

const guid = z.guid();

export const createAdminInputSchema = z.object({
  email: z
    .string({ error: 'Informe um e-mail válido' })
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: 'Informe um e-mail válido' })),
  // bcrypt só considera os primeiros 72 bytes: acima disso a senha seria truncada em silêncio.
  password: z
    .string({ error: 'Informe a senha' })
    .min(10, { error: 'A senha deve ter no mínimo 10 caracteres' })
    .refine((value) => Buffer.byteLength(value) <= 72, {
      error: 'A senha deve ter no máximo 72 caracteres',
    }),
  name: z
    .string({ error: 'Informe o nome' })
    .trim()
    .min(1, { error: 'Informe o nome' })
    .max(120, { error: 'O nome deve ter no máximo 120 caracteres' }),
});
export type CreateAdminInput = z.infer<typeof createAdminInputSchema>;

export class AdminEmailTakenError extends Error {
  constructor(readonly email: string) {
    super(`Já existe um admin com o e-mail ${email}`);
    this.name = 'AdminEmailTakenError';
  }
}

// Usada pelo AuthService e pelo script create-admin. Lança AdminEmailTakenError.
export async function createAdminAccount(
  pool: Pool,
  input: CreateAdminInput,
  bcryptCost: number,
): Promise<AdminRecord> {
  const passwordHash = await hash(input.password, bcryptCost);
  const admin = await insertAdmin(pool, {
    email: input.email,
    passwordHash,
    name: input.name,
  });
  if (!admin) throw new AdminEmailTakenError(input.email);
  return admin;
}

export interface AuthServiceDeps {
  pool: Pool;
  jwtSecret: string;
  bcryptCost: number;
}

const invalidCredentials = (): AppError =>
  new AppError(401, 'INVALID_CREDENTIALS', 'E-mail ou senha inválidos');

export class AuthService {
  // Criado já na construção: o 1º login com e-mail inexistente não custa mais que os seguintes.
  private readonly dummyHash: Promise<string>;

  constructor(private readonly deps: AuthServiceDeps) {
    this.dummyHash = hash('senha-que-nunca-sera-usada', deps.bcryptCost);
  }

  // E-mail inexistente e senha errada: MESMA resposta e tempo semelhante (o bcrypt roda nos
  // dois casos, contra um hash dummy quando o e-mail não existe).
  async login(email: string, password: string): Promise<AdminRecord> {
    const admin = await findAdminByEmail(this.deps.pool, email.trim().toLowerCase());
    const hashToCheck = admin ? admin.passwordHash : await this.dummyHash;
    const matches = await compare(password, hashToCheck);
    if (!admin || !matches) throw invalidCredentials();
    return { id: admin.id, email: admin.email, name: admin.name };
  }

  // HS256, 8h, payload { sub: adminId }.
  signToken(adminId: string): string {
    return jwt.sign({ sub: adminId }, this.deps.jwtSecret, {
      algorithm: 'HS256',
      expiresIn: TOKEN_TTL_SECONDS,
    });
  }

  // Devolve o id do admin ou null (assinatura, expiração, algoritmo e formato do sub validados).
  verifyToken(token: string): string | null {
    try {
      const payload = jwt.verify(token, this.deps.jwtSecret, { algorithms: ['HS256'] });
      if (typeof payload === 'string') return null;
      const sub = payload.sub;
      return typeof sub === 'string' && guid.safeParse(sub).success ? sub : null;
    } catch {
      return null;
    }
  }

  findAdmin(id: string): Promise<AdminRecord | null> {
    return findAdminById(this.deps.pool, id);
  }
}
