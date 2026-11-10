// @vitest-environment jsdom
import type { StockMovement } from '@bancada/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adjustAdminStock } from '../../api/adminProducts';
import { ApiError, NetworkError } from '../../api/http';
import { createQueryClient } from '../../app/queryClient';
import { PRODUCT_ID, makeAdminProduct } from '../../test/adminFixtures';
import { StockPanel } from './StockPanel';

vi.mock('../../api/adminProducts', () => ({ adjustAdminStock: vi.fn() }));
const mockAdjust = vi.mocked(adjustAdminStock);
const user = userEvent.setup();

const movement = (overrides: Partial<StockMovement> = {}): StockMovement => ({
  id: 1,
  productId: PRODUCT_ID,
  delta: 5,
  reason: 'restock',
  orderId: null,
  adminId: PRODUCT_ID,
  note: null,
  stockAfter: 12,
  createdAt: '2026-10-27T15:30:00.000Z',
  ...overrides,
});

function renderPanel(stock = 12, movements: StockMovement[] = []) {
  const client = createQueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <StockPanel productId={PRODUCT_ID} stock={stock} movements={movements} />
    </QueryClientProvider>,
  );
  return { client, invalidate };
}

const delta = () => screen.getByLabelText(/^Quantidade/) as HTMLInputElement;
const submit = () => user.click(screen.getByRole('button', { name: 'Ajustar estoque' }));
const result = () =>
  screen
    .getAllByRole('status')
    .map((e) => e.textContent)
    .join(' ');

beforeEach(() => {
  mockAdjust.mockReset();
});

describe('StockPanel: ajuste', () => {
  it('mostra o estoque atual e os campos (quantidade com sinal, motivo, observação)', () => {
    renderPanel(12);
    expect(screen.getByRole('heading', { level: 2, name: 'Estoque' })).toBeTruthy();
    expect(screen.getByText('Estoque atual')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(delta()).toBeTruthy();
    const reason = screen.getByLabelText('Motivo') as HTMLSelectElement;
    expect([...reason.options].map((o) => [o.value, o.text])).toEqual([
      ['restock', 'Reposição'],
      ['adjustment', 'Ajuste'],
    ]);
    expect(screen.getByLabelText(/^Observação/)).toBeTruthy();
  });

  it('envia delta inteiro com sinal, motivo e nota (aparada)', async () => {
    mockAdjust.mockResolvedValue({
      product: makeAdminProduct({ stock: 17 }),
      movement: movement({ delta: 5, stockAfter: 17 }),
    });
    renderPanel(12);
    await user.type(delta(), '+5');
    await user.selectOptions(screen.getByLabelText('Motivo'), 'adjustment');
    await user.type(screen.getByLabelText(/^Observação/), '  contagem do mês  ');
    await submit();
    await waitFor(() => expect(mockAdjust).toHaveBeenCalledTimes(1));
    expect(mockAdjust).toHaveBeenCalledWith(PRODUCT_ID, {
      delta: 5,
      reason: 'adjustment',
      note: 'contagem do mês',
    });
  });

  it('sucesso: anuncia "12 → 17", limpa o formulário, invalida lista, detalhe e loja', async () => {
    mockAdjust.mockResolvedValue({
      product: makeAdminProduct({ stock: 17 }),
      movement: movement({ delta: 5, stockAfter: 17 }),
    });
    const { client, invalidate } = renderPanel(12);
    await user.type(delta(), '5');
    await submit();
    await waitFor(() => expect(result()).toContain('Estoque ajustado: 12 → 17.'));
    expect(delta().value).toBe('');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'products'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'product', PRODUCT_ID] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['products'] });
    expect(client.getMutationCache().getAll().at(-1)?.options.mutationKey).toEqual([
      'admin',
      'stock',
      'adjust',
    ]);
  });

  it('retirar: delta negativo', async () => {
    mockAdjust.mockResolvedValue({
      product: makeAdminProduct({ stock: 9 }),
      movement: movement({ delta: -3, reason: 'adjustment', stockAfter: 9 }),
    });
    renderPanel(12);
    await user.type(delta(), '-3');
    await submit();
    await waitFor(() => expect(mockAdjust).toHaveBeenCalled());
    expect(mockAdjust.mock.calls[0]?.[1].delta).toBe(-3);
    await waitFor(() => expect(result()).toContain('Estoque ajustado: 12 → 9.'));
  });

  it('409 INVALID_STOCK_ADJUSTMENT: mensagem clara em role=alert com foco; o campo é preservado', async () => {
    mockAdjust.mockRejectedValue(new ApiError(409, 'INVALID_STOCK_ADJUSTMENT', 'x'));
    renderPanel(4);
    await user.type(delta(), '-10');
    await submit();
    const text = await screen.findByText(
      'Esse ajuste deixaria o estoque negativo. O estoque atual é 4; nada foi alterado.',
    );
    const alert = text.closest('[role=alert]');
    expect(alert).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(alert));
    expect(delta().value).toBe('-10');
    expect(
      screen.getByRole('button', { name: 'Ajustar estoque' }).getAttribute('aria-disabled'),
    ).toBe('false');
  });

  it('erro de rede: "A API está fora do ar"', async () => {
    mockAdjust.mockRejectedValue(new NetworkError());
    renderPanel();
    await user.type(delta(), '1');
    await submit();
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Confira o histórico de movimentações antes de repetir.',
    );
  });

  it('401: derruba a sessão (zera ["admin","me"])', async () => {
    mockAdjust.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'x'));
    const { client } = renderPanel();
    client.setQueryData(['admin', 'me'], { id: 'x' });
    await user.type(delta(), '1');
    await submit();
    await waitFor(() => expect(client.getQueryData(['admin', 'me'])).toBeNull());
  });

  it.each([
    ['', 'Informe a quantidade do ajuste'],
    ['0', 'A quantidade do ajuste não pode ser zero'],
    ['2,5', 'A quantidade deve ser um número inteiro, com sinal (ex.: 10 ou -3)'],
    ['abc', 'A quantidade deve ser um número inteiro, com sinal (ex.: 10 ou -3)'],
  ])(
    'validação "%s": mensagem do contracts, aria-describedby, foco e nada enviado',
    async (value, message) => {
      renderPanel();
      if (value) await user.type(delta(), value);
      await submit();
      const error = await screen.findByText(message);
      expect(error.getAttribute('role')).toBe('alert');
      expect(delta().getAttribute('aria-describedby')).toContain(error.id);
      expect(delta().getAttribute('aria-invalid')).toBe('true');
      expect(document.activeElement).toBe(delta());
      expect(mockAdjust).not.toHaveBeenCalled();
    },
  );

  it('observação com mais de 500 caracteres é recusada', async () => {
    renderPanel();
    await user.type(delta(), '1');
    await user.click(screen.getByLabelText(/^Observação/));
    await user.paste('x'.repeat(501));
    await submit();
    expect(await screen.findByText('A observação deve ter no máximo 500 caracteres')).toBeTruthy();
    expect(mockAdjust).not.toHaveBeenCalled();
  });

  it('durante o envio: "Ajustando…" aria-disabled e duplo clique = 1 chamada', async () => {
    let finish!: (value: Awaited<ReturnType<typeof adjustAdminStock>>) => void;
    mockAdjust.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderPanel();
    await user.type(delta(), '1');
    await submit();
    const button = await screen.findByRole('button', { name: 'Ajustando…' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    await user.dblClick(button);
    expect(mockAdjust).toHaveBeenCalledTimes(1);
    finish({ product: makeAdminProduct(), movement: movement({ stockAfter: 13 }) });
    await waitFor(() => expect(result()).toContain('Estoque ajustado'));
  });
});

describe('StockPanel: histórico', () => {
  it('sem movimentações: mensagem', () => {
    renderPanel(0, []);
    expect(screen.getByText('Nenhuma movimentação registrada.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('tabela com data, motivo, variação com sinal, estoque após, observação e pedido', () => {
    renderPanel(10, [
      movement({
        id: 3,
        delta: 5,
        reason: 'restock',
        note: 'caixa nova',
        stockAfter: 10,
        createdAt: '2026-10-27T15:30:00.000Z',
      }),
      movement({
        id: 2,
        delta: -2,
        reason: 'order',
        orderId: '3f2504e0-4f89-4d3a-9a0c-0305e82c3301',
        adminId: null,
        stockAfter: 5,
      }),
      movement({ id: 1, delta: 7, reason: 'initial', stockAfter: 7 }),
      movement({
        id: 4,
        delta: 2,
        reason: 'order_cancelled',
        orderId: '3f2504e0-4f89-4d3a-9a0c-0305e82c3301',
        stockAfter: 7,
      }),
    ]);
    expect(screen.getByRole('heading', { level: 3, name: 'Últimas movimentações' })).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Últimas movimentações do estoque' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Data', 'Motivo', 'Variação', 'Estoque após', 'Observação', 'Pedido']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(4);
    expect(rows[0]?.textContent).toContain('Reposição');
    expect(rows[0]?.textContent).toContain('+5');
    expect(rows[0]?.textContent).toContain('caixa nova');
    expect(rows[0]?.textContent).toMatch(/\d{2}\/\d{2}\/2026 \d{2}:\d{2}/);
    expect(rows[1]?.textContent).toContain('Pedido');
    expect(rows[1]?.textContent).toContain('−2');
    expect(rows[1]?.textContent).toContain('#3F2504E0');
    expect(rows[2]?.textContent).toContain('Estoque inicial');
    expect(rows[3]?.textContent).toContain('Pedido cancelado');
    expect(rows[3]?.textContent).toContain('+2');
  });
});
