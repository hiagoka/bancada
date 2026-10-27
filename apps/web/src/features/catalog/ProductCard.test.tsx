// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { LiveRegion } from '../../components/LiveRegion';
import { useAnnouncer } from '../../lib/announcer';
import { makeProduct } from '../../test/fixtures';
import { useCartStore } from '../cart/cartStore';
import { ProductCard } from './ProductCard';

beforeEach(() => {
  localStorage.clear();
  useCartStore.setState({ lines: [], notices: [] });
  useAnnouncer.setState({ message: '' });
});

const renderCard = (overrides = {}) => {
  const product = makeProduct({
    name: 'Mouse Ergonômico',
    priceCents: 24900,
    stock: 10,
    ...overrides,
  });
  render(
    <>
      <ProductCard product={product} />
      <LiveRegion />
    </>,
  );
  return product;
};

describe('ProductCard: conteúdo', () => {
  it('mostra título (h3), preço em reais pt-BR e o botão', () => {
    renderCard();
    expect(screen.getByRole('heading', { level: 3, name: 'Mouse Ergonômico' })).toBeTruthy();
    expect(screen.getByText(/R\$\s?249,00/)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Adicionar Mouse Ergonômico ao carrinho' }),
    ).toBeTruthy();
  });

  it.each([
    [1, 'Últimas 1 un.'],
    [3, 'Últimas 3 un.'],
    [0, 'Esgotado'],
  ])('estoque %d -> selo "%s"', (stock, label) => {
    const { container } = render(<ProductCard product={makeProduct({ stock })} />);
    const badge = container.querySelector('.status-badge');
    expect(badge?.textContent).toBe(label);
  });

  it('estoque 4 ou mais: sem selo', () => {
    const { container } = render(<ProductCard product={makeProduct({ stock: 4 })} />);
    expect(container.querySelector('.status-badge')).toBeNull();
  });
});

describe('ProductCard: botão de adicionar', () => {
  it('clica: adiciona ao carrinho e anuncia para leitores de tela (aria-live polite)', async () => {
    const product = renderCard();
    await userEvent.click(screen.getByRole('button', { name: /Adicionar Mouse Ergonômico/ }));
    expect(useCartStore.getState().lines).toEqual([{ product, quantity: 1 }]);
    const live = screen.getByRole('status');
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.textContent).toContain('Mouse Ergonômico adicionado ao carrinho');
    expect(live.textContent).toContain('1 no carrinho');
  });

  it('estoque esgotado: botão desabilitado e não adiciona', async () => {
    renderCard({ stock: 0 });
    const button = screen.getByRole('button', { name: /esgotado/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Esgotado');
    await userEvent.click(button);
    expect(useCartStore.getState().lines).toEqual([]);
  });

  it('chegou ao estoque máximo: aria-disabled com o texto "Máximo no carrinho", sem perder o foco', async () => {
    renderCard({ stock: 2 });
    const add = () => screen.getByRole('button') as HTMLButtonElement;
    await userEvent.click(add());
    expect(add().getAttribute('aria-disabled')).toBeNull();
    await userEvent.click(add());
    expect(add().getAttribute('aria-disabled')).toBe('true');
    expect(add().disabled).toBe(false); // continua focável (teclado não perde o lugar)
    expect(add().textContent).toBe('Máximo no carrinho');
    expect(add().getAttribute('aria-label')).toBe('Mouse Ergonômico: máximo no carrinho');
    expect(screen.getByRole('status').textContent).toContain('Máximo atingido');
    // clicar de novo NÃO adiciona e anuncia o motivo
    add().focus();
    await userEvent.click(add());
    expect(useCartStore.getState().lines[0]?.quantity).toBe(2);
    expect(document.activeElement).toBe(add());
    expect(screen.getByRole('status').textContent).toContain('máximo no carrinho');
  });

  it('já com o máximo no carrinho de outra visita (F5): nasce desabilitado', () => {
    const product = makeProduct({ stock: 2, name: 'Cabo' });
    useCartStore.getState().add(product, 2);
    render(<ProductCard product={product} />);
    expect(screen.getByRole('button').getAttribute('aria-disabled')).toBe('true');
  });

  it('o limite da API (999 por item) vale mesmo com estoque maior', async () => {
    const product = renderCard({ stock: 5000 });
    useCartStore.getState().add(product, 999);
    expect(
      (await screen.findAllByRole('button')).some(
        (b) => b.getAttribute('aria-disabled') === 'true',
      ),
    ).toBe(true);
  });
});
