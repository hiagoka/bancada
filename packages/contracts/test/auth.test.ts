import { adminSchema, loginInputSchema } from '../src/index.js';
import { messagesOf, uuid } from './fixtures.js';

describe('loginInputSchema', () => {
  it('aceita credenciais válidas', () => {
    const input = { email: 'admin@bancada.dev', password: 'segredo' };
    expect(loginInputSchema.parse(input)).toEqual(input);
  });

  it('rejeita e-mail inválido com mensagem em PT-BR', () => {
    const result = loginInputSchema.safeParse({ email: 'x', password: 'segredo' });
    expect(messagesOf(result)).toContain('Informe um e-mail válido');
  });

  it('rejeita senha vazia com mensagem em PT-BR', () => {
    const result = loginInputSchema.safeParse({ email: 'a@b.com', password: '' });
    expect(messagesOf(result)).toContain('Informe a senha');
  });
});

describe('adminSchema', () => {
  it('aceita admin válido', () => {
    const admin = { id: uuid, email: 'admin@bancada.dev', name: 'Admin' };
    expect(adminSchema.parse(admin)).toEqual(admin);
  });

  it('nunca expõe o hash da senha', () => {
    const parsed = adminSchema.parse({
      id: uuid,
      email: 'a@b.com',
      name: 'Admin',
      passwordHash: 'x',
    });
    expect(parsed).not.toHaveProperty('passwordHash');
  });
});
