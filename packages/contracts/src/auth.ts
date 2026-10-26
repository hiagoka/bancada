import { z } from 'zod';

export const loginInputSchema = z.object({
  email: z
    .string({ error: 'Informe um e-mail válido' })
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: 'Informe um e-mail válido' })),
  password: z.string({ error: 'Informe a senha' }).min(1, { error: 'Informe a senha' }),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

export const adminSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  name: z.string(),
});
export type Admin = z.infer<typeof adminSchema>;
