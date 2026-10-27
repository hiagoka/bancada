import { adminSchema, loginInputSchema, type Admin, type LoginInput } from '@bancada/contracts';
import { request } from './http';

// POST /auth/login. O corpo passa pelo schema do contracts (e-mail em minúsculo, sem espaços) e
// leva SÓ e-mail e senha. O JWT chega num cookie httpOnly: o web nunca o vê nem o guarda.
export async function login(input: LoginInput): Promise<Admin> {
  const body = loginInputSchema.parse(input);
  return request('/auth/login', {
    method: 'POST',
    body: { email: body.email, password: body.password },
    schema: adminSchema,
  });
}

// POST /auth/logout (o http.ts manda o corpo '{}' exigido pelo CSRF).
export async function logout(): Promise<void> {
  await request('/auth/logout', { method: 'POST' });
}

// GET /auth/me: 401 quando não há sessão válida.
export function me(signal?: AbortSignal): Promise<Admin> {
  return request('/auth/me', { schema: adminSchema, signal });
}
