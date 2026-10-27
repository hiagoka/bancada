// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchProducts } from '../../api/products';
import { makeProduct } from '../../test/fixtures';
import { CartPage } from './CartPage';
import { useCartStore } from './cartStore';

vi.mock('../../api/products', () => ({ fetchProducts: vi.fn() }));
const mockFetch = vi.mocked(fetchProducts);

beforeEach(() => {
  mockFetch.mockReset();
  localStorage.clear();
  useCartStore.setState({ lines: [], notices: [] });
});

// O catálogo vem do fetchProducts mockado (o carrinho SEMPRE revalida ao abrir: refetchOnMount).
function renderCart(catalog: ReturnType<typeof makeProduct>[] | Error) {
  if (catalog instanceof Error) mockFetch.mockRejectedValue(catalog);
  else mockFetch.mockResolvedValue(catalog);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CartPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const statusText = () => screen.getByRole('status').textContent ?? '';

describe('CartPage', () => {
  it('carrinho vazio: mensagem e link para o catálogo; sem formulário de checkout', () => {
    renderCart([]);
    expect(screen.getByRole('heading', { level: 1, name: 'Carrinho' })).toBeTruthy();
    expect(screen.getByText('Seu carrinho está vazio.')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Ver o catálogo' });
    expect(link.getAttribute('href')).toBe('/');
    expect(screen.queryByTestId('checkout-slot')).toBeNull();
  });

  it('com itens: linhas, total em reais e o lugar do checkout (T15), sem criar pedido', () => {
    const a = makeProduct({ name: 'Mouse', priceCents: 24900, stock: 9 });
    const b = makeProduct({ name: 'Caneca', priceCents: 4900, stock: 9 });
    useCartStore.getState().add(a, 2);
    useCartStore.getState().add(b, 1);
    renderCart([a, b]);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(
      expect.arrayContaining(['Mouse', 'Caneca']),
    );
    expect(screen.getByText(/R\$\s?547,00/)).toBeTruthy(); // 2 × 249 + 49 = 547
    expect(screen.getByTestId('checkout-slot')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull(); // nenhum campo de formulário ainda
  });

  it('ao chegar o catálogo, ajusta a quantidade ao estoque e avisa (role=status)', async () => {
    const product = makeProduct({ name: 'Hub USB-C', stock: 9 });
    useCartStore.getState().add(product, 6);
    renderCart([{ ...product, stock: 2 }]);
    await waitFor(() =>
      expect(statusText()).toContain('Ajustamos a quantidade de Hub USB-C ao estoque disponível'),
    );
    expect(useCartStore.getState().lines[0]?.quantity).toBe(2);
    expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('2');
  });

  it('produto que sumiu do catálogo sai do carrinho, com aviso; "Entendi" fecha o aviso', async () => {
    const gone = makeProduct({ name: 'Descontinuado' });
    useCartStore.getState().add(gone);
    renderCart([makeProduct()]);
    await waitFor(() => expect(statusText()).toContain('Descontinuado'));
    expect(screen.getByText('Seu carrinho está vazio.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Entendi' }));
    expect(statusText()).toBe(''); // a região continua montada, só sem texto
  });

  it('produto sem estoque e mudança de preço também avisam', async () => {
    const soldOut = makeProduct({ name: 'Esgotou', stock: 3 });
    const repriced = makeProduct({ name: 'Reajustado', stock: 5, priceCents: 1000 });
    useCartStore.getState().add(soldOut);
    useCartStore.getState().add(repriced);
    renderCart([
      { ...soldOut, stock: 0 },
      { ...repriced, priceCents: 1500 },
    ]);
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('Esgotou ficou sem estoque'),
    );
    expect(screen.getByRole('status').textContent).toMatch(
      /preço de Reajustado mudou de R\$\s?10,00 para R\$\s?15,00/,
    );
  });

  it('sem nenhuma diferença, não mostra aviso', async () => {
    const product = makeProduct({ stock: 5 });
    useCartStore.getState().add(product, 2);
    renderCart([product]);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(statusText()).toBe('');
  });

  it('revalida o estoque ao abrir (não confia só no cache): chama a API', async () => {
    useCartStore.getState().add(makeProduct({ stock: 5 }));
    renderCart([]);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
  });

  it('se a API falhar, o carrinho continua visível e avisa que o estoque não foi conferido', async () => {
    const product = makeProduct({ name: 'Cabo', stock: 5 });
    useCartStore.getState().add(product, 2);
    renderCart(new Error('falhou'));
    await waitFor(() =>
      expect(statusText()).toContain('Não foi possível conferir o estoque agora'),
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Cabo' })).toBeTruthy();
    expect(useCartStore.getState().lines[0]?.quantity).toBe(2); // nada é removido sem certeza
  });
});
