// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listAdminProducts } from '../../api/adminProducts';
import { ApiError, NetworkError } from '../../api/http';
import { createQueryClient } from '../../app/queryClient';
import { makeAdminProduct } from '../../test/adminFixtures';
import { ProductsListPage } from './ProductsListPage';

vi.mock('../../api/adminProducts', () => ({ listAdminProducts: vi.fn() }));
const mockList = vi.mocked(listAdminProducts);
const user = userEvent.setup();

function renderPage(state?: { notice: string }) {
  const client = createQueryClient();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[{ pathname: '/admin/produtos', state }]}>
        <Routes>
          <Route path="/admin/produtos" element={<ProductsListPage />} />
          <Route path="/admin/produtos/novo" element={<p>FORM NOVO</p>} />
          <Route path="/admin/produtos/:id" element={<p>FORM EDITAR</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

const rows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);

beforeEach(() => {
  mockList.mockReset();
});

describe('ProductsListPage', () => {
  it('tabela com nome (link p/ edição), categoria, preço em reais, estoque e status em texto', async () => {
    mockList.mockResolvedValue([
      makeAdminProduct(),
      makeAdminProduct({
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Caneca Dev',
        category: 'Canecas',
        priceCents: 4900,
        stock: 0,
        active: false,
      }),
    ]);
    renderPage();
    await screen.findByRole('table');
    const [first, second] = rows();
    expect(
      within(first!).getByRole('link', { name: 'Teclado Mecânico' }).getAttribute('href'),
    ).toBe('/admin/produtos/6ba7b810-9dad-41d1-80b5-00c04fd430c8');
    expect(first?.textContent).toMatch(/R\$\s?349,90/);
    expect(first?.textContent).toContain('12');
    expect(first?.textContent).toContain('Ativo');
    expect(second?.textContent).toMatch(/R\$\s?49,00/);
    expect(second?.textContent).toContain('Inativo');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Imagem',
      'Nome',
      'Categoria',
      'Preço',
      'Estoque',
      'Situação',
    ]);
  });

  it('mostra o aviso deixado pelo formulário (role=status)', async () => {
    mockList.mockResolvedValue([makeAdminProduct()]);
    renderPage({ notice: 'Produto “Teclado” criado.' });
    await screen.findByRole('table');
    expect(
      screen.getAllByRole('status').some((e) => e.textContent === 'Produto “Teclado” criado.'),
    ).toBe(true);
  });

  it('"Novo produto" leva ao formulário de criação', async () => {
    mockList.mockResolvedValue([]);
    renderPage();
    await user.click(await screen.findByRole('link', { name: 'Novo produto' }));
    expect(await screen.findByText('FORM NOVO')).toBeTruthy();
  });

  it('lista vazia (sem filtro): mensagem e convite a criar', async () => {
    mockList.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('Nenhum produto cadastrado ainda.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('carregando: mensagem em role=status', async () => {
    let release!: (value: ReturnType<typeof makeAdminProduct>[]) => void;
    mockList.mockReturnValue(new Promise((resolve) => (release = resolve)));
    renderPage();
    expect(screen.getAllByText('Carregando produtos…').length).toBeGreaterThan(0);
    release([]);
    await screen.findByText('Nenhum produto cadastrado ainda.');
  });

  it('erro de rede: "A API está fora do ar" com "Tentar de novo"', async () => {
    mockList.mockRejectedValueOnce(new NetworkError()).mockRejectedValueOnce(new NetworkError());
    mockList.mockRejectedValueOnce(new NetworkError());
    renderPage();
    expect((await screen.findByRole('alert', {}, { timeout: 4000 })).textContent).toContain(
      'A API está fora do ar.',
    );
    mockList.mockResolvedValue([makeAdminProduct()]);
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByRole('table')).toBeTruthy();
  });

  it('erro 500: mensagem genérica', async () => {
    mockList.mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'x'));
    renderPage();
    expect((await screen.findByRole('alert', {}, { timeout: 6000 })).textContent).toContain(
      'Não foi possível carregar os produtos.',
    );
  }, 10_000);

  it('busca por nome: envia q (aparado) à API depois de uma pausa', async () => {
    mockList.mockResolvedValue([makeAdminProduct()]);
    renderPage();
    await screen.findByRole('table');
    mockList.mockClear();
    await user.type(screen.getByLabelText('Buscar por nome'), 'mouse');
    await waitFor(() =>
      expect(mockList).toHaveBeenLastCalledWith({ q: 'mouse', active: 'all' }, expect.anything()),
    );
    // não dispara uma consulta por tecla
    expect(mockList.mock.calls.length).toBeLessThan(5);
  });

  it('filtro de situação: Ativos / Inativos / Todos', async () => {
    mockList.mockResolvedValue([makeAdminProduct()]);
    renderPage();
    await screen.findByRole('table');
    await user.selectOptions(screen.getByLabelText('Situação'), 'false');
    await waitFor(() =>
      expect(mockList).toHaveBeenLastCalledWith({ q: '', active: 'false' }, expect.anything()),
    );
    expect(screen.getByRole('option', { name: 'Ativos' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Inativos' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Todos' })).toBeTruthy();
  });

  it('com filtro e sem resultado: "Nenhum produto encontrado" (e não o convite a criar)', async () => {
    mockList.mockResolvedValueOnce([makeAdminProduct()]).mockResolvedValue([]);
    renderPage();
    await screen.findByRole('table');
    await user.type(screen.getByLabelText('Buscar por nome'), 'zzz');
    expect(await screen.findByText('Nenhum produto encontrado.')).toBeTruthy();
  });

  it('anuncia a quantidade de produtos (role=status)', async () => {
    mockList.mockResolvedValue([makeAdminProduct(), makeAdminProduct({ id: 'b', name: 'B' })]);
    renderPage();
    await screen.findByRole('table');
    expect(screen.getAllByRole('status').some((e) => e.textContent === '2 produtos')).toBe(true);
  });
});
