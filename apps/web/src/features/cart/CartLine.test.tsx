// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAnnouncer } from '../../lib/announcer';
import { makeProduct } from '../../test/fixtures';
import { CartLine } from './CartLine';
import { useCartStore } from './cartStore';

beforeEach(() => {
  localStorage.clear();
  useCartStore.setState({ lines: [], notices: [] });
  useAnnouncer.setState({ message: '' });
});

function setup(stock = 5, quantity = 2) {
  const product = makeProduct({ name: 'Headset', priceCents: 34990, stock });
  useCartStore.getState().add(product, quantity);
  const line = () => useCartStore.getState().lines[0]!;
  const view = () =>
    render(
      <ul>
        <CartLine line={line()} />
      </ul>,
    );
  return { product, line, view };
}

const qtyInput = () =>
  screen.getByRole('spinbutton', { name: 'Quantidade de Headset' }) as HTMLInputElement;
const plus = () =>
  screen.getByRole('button', { name: 'Aumentar quantidade de Headset' }) as HTMLButtonElement;
const minus = () =>
  screen.getByRole('button', { name: 'Diminuir quantidade de Headset' }) as HTMLButtonElement;

describe('CartLine', () => {
  it('mostra nome (h2), preço unitário, quantidade e subtotal da linha em reais', () => {
    const { view } = setup(5, 3);
    view();
    expect(screen.getByRole('heading', { level: 2, name: 'Headset' })).toBeTruthy();
    expect(screen.getByText(/R\$\s?349,90 cada/)).toBeTruthy();
    expect(qtyInput().value).toBe('3');
    expect(screen.getByText(/R\$\s?1\.049,70/)).toBeTruthy();
  });

  it('+ aumenta e - diminui', async () => {
    const { view, line } = setup(5, 2);
    const { rerender } = view();
    await userEvent.click(plus());
    expect(line().quantity).toBe(3);
    rerender(
      <ul>
        <CartLine line={line()} />
      </ul>,
    );
    await userEvent.click(minus());
    expect(line().quantity).toBe(2);
  });

  it('+ fica aria-disabled no estoque máximo (focável), não aumenta e mostra o limite', async () => {
    const { view, line } = setup(3, 3);
    view();
    expect(plus().getAttribute('aria-disabled')).toBe('true');
    expect(plus().disabled).toBe(false);
    await userEvent.click(plus());
    expect(line().quantity).toBe(3);
    expect(useAnnouncer.getState().message).toContain('Máximo atingido');
    expect(screen.getByText(/Máximo disponível: 3 un\./)).toBeTruthy();
  });

  it('- fica aria-disabled na quantidade 1 e não remove (para sair há o botão Remover)', async () => {
    const { view, line } = setup(5, 1);
    view();
    expect(minus().getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(minus());
    expect(line().quantity).toBe(1);
  });

  it('o limite da API (999) vale no campo e no máximo, mesmo com estoque maior', () => {
    const { view } = setup(5000, 999);
    view();
    expect(qtyInput().max).toBe('999');
    expect(plus().getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText(/Máximo disponível: 999 un\./)).toBeTruthy();
  });

  it('anuncia a nova quantidade (aria-live) ao mudar e a remoção ao digitar 0', async () => {
    const { view } = setup(5, 2);
    view();
    await userEvent.click(plus());
    expect(useAnnouncer.getState().message).toBe('Quantidade de Headset: 3.');
    await userEvent.clear(qtyInput());
    await userEvent.type(qtyInput(), '0{Enter}');
    expect(useAnnouncer.getState().message).toBe('Headset removido do carrinho.');
  });

  it('digitar uma quantidade acima do estoque limita ao estoque (ao confirmar com Enter)', async () => {
    const { view, line } = setup(4, 1);
    view();
    await userEvent.clear(qtyInput());
    await userEvent.type(qtyInput(), '99{Enter}');
    expect(line().quantity).toBe(4);
  });

  it('digitar 0 remove a linha; texto vazio volta ao valor anterior', async () => {
    const { view } = setup(5, 2);
    view();
    await userEvent.clear(qtyInput());
    await userEvent.tab(); // blur com campo vazio
    expect(useCartStore.getState().lines[0]?.quantity).toBe(2);
    await userEvent.clear(qtyInput());
    await userEvent.type(qtyInput(), '0{Enter}');
    expect(useCartStore.getState().lines).toEqual([]);
  });

  it('Remover tira a linha do carrinho', async () => {
    const { view } = setup();
    view();
    await userEvent.click(screen.getByRole('button', { name: 'Remover Headset do carrinho' }));
    expect(useCartStore.getState().lines).toEqual([]);
  });
});
