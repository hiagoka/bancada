// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAdminProduct } from '../../api/adminProducts';
import { ApiError, NetworkError } from '../../api/http';
import { createQueryClient } from '../../app/queryClient';
import { IMAGE_KEY, makeAdminProduct } from '../../test/adminFixtures';
import { ProductFormPage } from './ProductFormPage';
import { uploadProductImage } from './uploadImage';

vi.mock('../../api/adminProducts', () => ({
  createAdminProduct: vi.fn(),
  updateAdminProduct: vi.fn(),
  getAdminProduct: vi.fn(),
}));
vi.mock('./uploadImage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./uploadImage')>()),
  uploadProductImage: vi.fn(),
}));
const mockCreate = vi.mocked(createAdminProduct);
const mockUpload = vi.mocked(uploadProductImage);
const user = userEvent.setup({ applyAccept: false });

function Landing() {
  const location = useLocation();
  const state = location.state as { notice?: string } | null;
  return <p>LISTA {state?.notice}</p>;
}

function renderPage() {
  const client = createQueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/admin/produtos/novo']}>
        <Routes>
          <Route path="/admin/produtos/novo" element={<ProductFormPage />} />
          <Route path="/admin/produtos" element={<Landing />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, invalidate };
}

const fillValid = async (overrides: Record<string, string> = {}) => {
  const values = {
    Nome: 'Teclado Mecânico',
    Descrição: 'Switch marrom',
    Categoria: 'Teclados',
    'Preço (R$)': '349,90',
    'Estoque inicial': '10',
    ...overrides,
  };
  for (const [label, value] of Object.entries(values)) {
    const field = screen.getByLabelText(label);
    await user.clear(field);
    if (value) await user.type(field, value);
  }
};
const submit = () => user.click(screen.getByRole('button', { name: 'Criar produto' }));

beforeEach(() => {
  mockCreate.mockReset();
  mockUpload.mockReset();
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});

describe('ProductFormPage: criação', () => {
  it('um h1, campos com label, sem campo de ativo/slug e título da aba', async () => {
    renderPage();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Novo produto');
    for (const label of ['Nome', 'Descrição', 'Categoria', 'Preço (R$)', 'Estoque inicial']) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    expect(screen.queryByLabelText(/ativo/i)).toBeNull();
    expect(screen.queryByLabelText(/slug/i)).toBeNull();
    expect(document.title).toBe('Novo produto · Bancada');
  });

  it('a dica do preço manda usar vírgula para os centavos', async () => {
    renderPage();
    const hint = screen.getByText('Em reais, use vírgula para os centavos (ex.: 349,90).');
    expect(screen.getByLabelText('Preço (R$)').getAttribute('aria-describedby')).toContain(hint.id);
  });

  it('envia centavos INTEIROS (349,90 -> 34990), textos aparados e SEM active/stock', async () => {
    mockCreate.mockResolvedValue(makeAdminProduct());
    renderPage();
    await fillValid({ Nome: '  Teclado Mecânico  ' });
    await submit();
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate.mock.calls[0]?.[0]).toEqual({
      name: 'Teclado Mecânico',
      description: 'Switch marrom',
      category: 'Teclados',
      priceCents: 34990,
      initialStock: 10,
    });
  });

  it.each([
    ['19,99', 1999],
    ['1.349,90', 134990],
    ['0,29', 29],
    ['10', 1000],
  ])('preço "%s" vira %i centavos (sem float)', async (price, cents) => {
    mockCreate.mockResolvedValue(makeAdminProduct());
    renderPage();
    await fillValid({ 'Preço (R$)': price });
    await submit();
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect(mockCreate.mock.calls[0]?.[0].priceCents).toBe(cents);
  });

  it('sucesso: invalida admin/products, admin/product e products e volta à lista com aviso', async () => {
    mockCreate.mockResolvedValue(makeAdminProduct());
    const { invalidate } = renderPage();
    await fillValid();
    await submit();
    expect(await screen.findByText(/LISTA/)).toBeTruthy();
    expect(screen.getByText(/Produto “Teclado Mecânico” criado\./)).toBeTruthy();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'products'] });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['admin', 'product', makeAdminProduct().id],
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['products'] });
  });

  it('a mutação tem a chave ["admin","product","create"]', async () => {
    mockCreate.mockResolvedValue(makeAdminProduct());
    const { client } = renderPage();
    await fillValid();
    await submit();
    await screen.findByText(/LISTA/);
    expect(client.getMutationCache().getAll().at(-1)?.options.mutationKey).toEqual([
      'admin',
      'product',
      'create',
    ]);
  });

  it('vazio: mensagens PT-BR do contracts, ligadas por aria-describedby, foco no primeiro inválido', async () => {
    renderPage();
    await submit();
    const nameError = await screen.findByText('Informe o nome do produto');
    expect(nameError.getAttribute('role')).toBe('alert');
    expect(screen.getByLabelText('Nome').getAttribute('aria-describedby')).toContain(nameError.id);
    expect(screen.getByLabelText('Nome').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Informe a descrição do produto')).toBeTruthy();
    expect(screen.getByText('Informe a categoria do produto')).toBeTruthy();
    expect(screen.getByText('Informe o preço')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText('Nome'));
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('preço inválido: mensagem de formato', async () => {
    renderPage();
    await fillValid({ 'Preço (R$)': 'abc' });
    await submit();
    expect(await screen.findByText('Preço inválido. Use o formato 349,90.')).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('com imagem enviada: imageKey vai no corpo', async () => {
    mockUpload.mockResolvedValue(IMAGE_KEY);
    mockCreate.mockResolvedValue(makeAdminProduct());
    renderPage();
    await fillValid();
    await user.upload(
      screen.getByLabelText('Imagem do produto'),
      new File(['x'], 'foto.png', { type: 'image/png' }),
    );
    await screen.findByText(/Imagem enviada\./);
    await submit();
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect(mockCreate.mock.calls[0]?.[0].imageKey).toBe(IMAGE_KEY);
  });

  it('upload em andamento: salvar fica bloqueado (aria-disabled) e não envia', async () => {
    mockUpload.mockReturnValue(new Promise(() => undefined));
    renderPage();
    await fillValid();
    await user.upload(
      screen.getByLabelText('Imagem do produto'),
      new File(['x'], 'foto.png', { type: 'image/png' }),
    );
    await screen.findByRole('progressbar');
    const button = screen.getByRole('button', { name: 'Criar produto' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    await user.click(button);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(screen.getByText('Aguarde o envio da imagem para salvar.')).toBeTruthy();
  });

  it('durante o envio: "Criando…" aria-disabled e duplo clique = 1 chamada', async () => {
    let finish!: (p: ReturnType<typeof makeAdminProduct>) => void;
    mockCreate.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderPage();
    await fillValid();
    await submit();
    const button = await screen.findByRole('button', { name: 'Criando…' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    await user.dblClick(button);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    finish(makeAdminProduct());
    await screen.findByText(/LISTA/);
  });

  it('409 SLUG_TAKEN: mensagem clara em role=alert com o foco, dados preservados', async () => {
    mockCreate.mockRejectedValue(new ApiError(409, 'SLUG_TAKEN', 'x'));
    renderPage();
    await fillValid();
    await submit();
    const alert = await screen.findByText(
      'Já existe um produto com esse nome. Escolha outro nome.',
    );
    expect(alert.closest('[role=alert]')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(alert.closest('[role=alert]')));
    expect((screen.getByLabelText('Nome') as HTMLInputElement).value).toBe('Teclado Mecânico');
    expect(
      screen.getByRole('button', { name: 'Criar produto' }).getAttribute('aria-disabled'),
    ).toBe('false');
  });

  it('erro de rede: "A API está fora do ar"', async () => {
    mockCreate.mockRejectedValue(new NetworkError());
    renderPage();
    await fillValid();
    await submit();
    expect((await screen.findByRole('alert')).textContent).toContain('A API está fora do ar.');
  });

  it('401: derruba a sessão (zera ["admin","me"])', async () => {
    mockCreate.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'x'));
    const { client } = renderPage();
    client.setQueryData(['admin', 'me'], { id: 'x' });
    await fillValid();
    await submit();
    await waitFor(() => expect(client.getQueryData(['admin', 'me'])).toBeNull());
  });
});
