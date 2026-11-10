// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adjustAdminStock, getAdminProduct, updateAdminProduct } from '../../api/adminProducts';
import { ApiError, NetworkError } from '../../api/http';
import { createQueryClient } from '../../app/queryClient';
import { IMAGE_KEY, PRODUCT_ID, makeAdminProduct } from '../../test/adminFixtures';
import { ProductFormPage } from './ProductFormPage';
import { uploadProductImage } from './uploadImage';

vi.mock('../../api/adminProducts', () => ({
  createAdminProduct: vi.fn(),
  updateAdminProduct: vi.fn(),
  getAdminProduct: vi.fn(),
  adjustAdminStock: vi.fn(),
}));
vi.mock('./uploadImage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./uploadImage')>()),
  uploadProductImage: vi.fn(),
}));
const mockGet = vi.mocked(getAdminProduct);
const mockUpdate = vi.mocked(updateAdminProduct);
const mockAdjust = vi.mocked(adjustAdminStock);
const mockUpload = vi.mocked(uploadProductImage);
const user = userEvent.setup({ applyAccept: false });

const detail = (overrides: Parameters<typeof makeAdminProduct>[0] = {}) => ({
  ...makeAdminProduct(overrides),
  movements: [],
});

function Landing() {
  const state = useLocation().state as { notice?: string } | null;
  return <p>LISTA {state?.notice}</p>;
}

function renderPage(id = PRODUCT_ID) {
  const client = createQueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/admin/produtos/${id}`]}>
        <Routes>
          <Route path="/admin/produtos/:id" element={<ProductFormPage />} />
          <Route path="/admin/produtos" element={<Landing />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, invalidate };
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const ready = () => screen.findByRole('button', { name: 'Salvar alterações' });
const save = () => user.click(screen.getByRole('button', { name: 'Salvar alterações' }));
const retype = async (label: string, value: string) => {
  await user.clear(field(label));
  await user.type(field(label), value);
};

beforeEach(() => {
  mockGet.mockReset();
  mockUpdate.mockReset();
  mockAdjust.mockReset();
  mockUpload.mockReset();
  mockGet.mockResolvedValue(detail());
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});

describe('ProductFormPage: edição', () => {
  it('carrega o produto: campos preenchidos, preço em reais, slug somente leitura, estoque atual', async () => {
    renderPage();
    await ready();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Editar produto');
    expect(field('Nome').value).toBe('Teclado Mecânico');
    expect(field('Descrição').value).toBe('Switch marrom, layout ABNT2.');
    expect(field('Categoria').value).toBe('Teclados');
    expect(field('Preço (R$)').value).toBe('349,90');
    expect(
      (screen.getByLabelText('Produto ativo (aparece na loja)') as HTMLInputElement).checked,
    ).toBe(true);
    const slug = field('Slug (não pode ser alterado)');
    expect(slug.value).toBe('teclado-mecanico');
    expect(slug.readOnly).toBe(true);
    expect(screen.getByText('Estoque atual')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.queryByLabelText('Estoque inicial')).toBeNull();
  });

  it('a dica do preço manda usar vírgula para os centavos', async () => {
    renderPage();
    await ready();
    expect(screen.getByText('Em reais, use vírgula para os centavos (ex.: 349,90).')).toBeTruthy();
  });

  it('sem alteração: não chama a API e avisa', async () => {
    renderPage();
    await ready();
    await save();
    expect(await screen.findByText('Nenhuma alteração para salvar.')).toBeTruthy();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('PATCH só com o que mudou; preço em reais vira centavos inteiros', async () => {
    mockUpdate.mockResolvedValue(makeAdminProduct());
    renderPage();
    await ready();
    await retype('Nome', '  Teclado Novo  ');
    await retype('Preço (R$)', '399,9');
    await save();
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate).toHaveBeenCalledWith(PRODUCT_ID, {
      name: 'Teclado Novo',
      priceCents: 39990,
    });
  });

  it('desativar vai como active false', async () => {
    mockUpdate.mockResolvedValue(makeAdminProduct({ active: false }));
    renderPage();
    await ready();
    await user.click(screen.getByLabelText('Produto ativo (aparece na loja)'));
    await save();
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    expect(mockUpdate).toHaveBeenCalledWith(PRODUCT_ID, { active: false });
  });

  it('sucesso: invalida lista, detalhe e loja; volta à lista com aviso; chave de mutação admin', async () => {
    mockUpdate.mockResolvedValue(makeAdminProduct());
    const { client, invalidate } = renderPage();
    await ready();
    await retype('Categoria', 'Periféricos');
    await save();
    expect(await screen.findByText(/Produto “Teclado Mecânico” atualizado\./)).toBeTruthy();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'products'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'product', PRODUCT_ID] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['products'] });
    expect(client.getMutationCache().getAll().at(-1)?.options.mutationKey).toEqual([
      'admin',
      'product',
      'update',
    ]);
  });

  it('validação: campo vazio mostra a mensagem do contracts e foca nele', async () => {
    renderPage();
    await ready();
    await retype('Nome', ' ');
    await save();
    expect(await screen.findByText('Informe o nome do produto')).toBeTruthy();
    expect(document.activeElement).toBe(field('Nome'));
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('nova imagem enviada: imageKey (string) no PATCH', async () => {
    mockGet.mockResolvedValue(
      detail({
        imageUrl: 'http://s3/velha.png',
        imageKey: 'products/22222222-2222-4222-8222-222222222222.png',
      }),
    );
    mockUpload.mockResolvedValue(IMAGE_KEY);
    mockUpdate.mockResolvedValue(makeAdminProduct());
    renderPage();
    await ready();
    expect(screen.getByAltText('Imagem atual do produto')).toBeTruthy();
    await user.upload(
      screen.getByLabelText('Imagem do produto'),
      new File(['x'], 'nova.png', { type: 'image/png' }),
    );
    await screen.findByText(/Imagem enviada\./);
    await save();
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    expect(mockUpdate).toHaveBeenCalledWith(PRODUCT_ID, { imageKey: IMAGE_KEY });
  });

  it('remover imagem: imageKey null no PATCH (D16)', async () => {
    mockGet.mockResolvedValue(detail({ imageUrl: 'http://s3/velha.png', imageKey: IMAGE_KEY }));
    mockUpdate.mockResolvedValue(makeAdminProduct());
    renderPage();
    await ready();
    await user.click(screen.getByRole('button', { name: 'Remover imagem' }));
    await save();
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    expect(mockUpdate).toHaveBeenCalledWith(PRODUCT_ID, { imageKey: null });
  });

  it('manter a imagem: imageKey ausente do PATCH', async () => {
    mockGet.mockResolvedValue(detail({ imageUrl: 'http://s3/velha.png', imageKey: IMAGE_KEY }));
    mockUpdate.mockResolvedValue(makeAdminProduct());
    renderPage();
    await ready();
    await retype('Nome', 'Outro');
    await save();
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    expect(Object.keys(mockUpdate.mock.calls[0]?.[1] ?? {})).toEqual(['name']);
  });

  it('upload em andamento bloqueia o salvar', async () => {
    mockUpload.mockReturnValue(new Promise(() => undefined));
    renderPage();
    await ready();
    await retype('Nome', 'Outro');
    await user.upload(
      screen.getByLabelText('Imagem do produto'),
      new File(['x'], 'nova.png', { type: 'image/png' }),
    );
    await screen.findByRole('progressbar');
    await save();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Salvar alterações' }).getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('durante o envio: "Salvando…" e duplo clique = 1 PATCH', async () => {
    let finish!: (p: ReturnType<typeof makeAdminProduct>) => void;
    mockUpdate.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderPage();
    await ready();
    await retype('Nome', 'Outro');
    await save();
    const button = await screen.findByRole('button', { name: 'Salvando…' });
    await user.dblClick(button);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    finish(makeAdminProduct());
    await screen.findByText(/LISTA/);
  });

  it('409 / erro de API: mensagem em role=alert com foco, dados preservados', async () => {
    mockUpdate.mockRejectedValue(new ApiError(409, 'SLUG_TAKEN', 'x'));
    renderPage();
    await ready();
    await retype('Nome', 'Outro');
    await save();
    const alert = (await screen.findByText(/Já existe um produto com esse nome/)).closest(
      '[role=alert]',
    );
    await waitFor(() => expect(document.activeElement).toBe(alert));
    expect(field('Nome').value).toBe('Outro');
  });

  it('401 ao salvar: derruba a sessão', async () => {
    mockUpdate.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'x'));
    const { client } = renderPage();
    client.setQueryData(['admin', 'me'], { id: 'x' });
    await ready();
    await retype('Nome', 'Outro');
    await save();
    await waitFor(() => expect(client.getQueryData(['admin', 'me'])).toBeNull());
  });
});

describe('ProductFormPage: edição com painel de estoque', () => {
  it('o estoque deixa de ser somente leitura: painel com histórico, fora do <form> do produto', async () => {
    mockGet.mockResolvedValue({
      ...detail(),
      movements: [
        {
          id: 1,
          productId: PRODUCT_ID,
          delta: 12,
          reason: 'initial',
          orderId: null,
          adminId: PRODUCT_ID,
          note: null,
          stockAfter: 12,
          createdAt: '2026-10-27T12:00:00.000Z',
        },
      ],
    });
    renderPage();
    await ready();
    expect(screen.getByRole('heading', { level: 2, name: 'Estoque' })).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Últimas movimentações do estoque' })).toBeTruthy();
    const adjustForm = screen.getByRole('button', { name: 'Ajustar estoque' }).closest('form');
    const productForm = screen.getByRole('button', { name: 'Salvar alterações' }).closest('form');
    expect(adjustForm).not.toBe(productForm);
    expect(productForm?.contains(adjustForm)).toBe(false);
    expect(document.querySelectorAll('form form')).toHaveLength(0);
  });

  it('depois de ajustar, o painel mostra o estoque novo e a movimentação (consulta invalidada)', async () => {
    const adjusted = {
      id: 9,
      productId: PRODUCT_ID,
      delta: 5,
      reason: 'restock' as const,
      orderId: null,
      adminId: PRODUCT_ID,
      note: 'caixa',
      stockAfter: 17,
      createdAt: '2026-10-27T13:00:00.000Z',
    };
    mockAdjust.mockImplementation(async () => {
      mockGet.mockResolvedValue({ ...detail({ stock: 17 }), movements: [adjusted] });
      return { product: makeAdminProduct({ stock: 17 }), movement: adjusted };
    });
    renderPage();
    await ready();
    await user.type(screen.getByLabelText(/^Quantidade/), '5');
    await user.click(screen.getByRole('button', { name: 'Ajustar estoque' }));
    await waitFor(() =>
      expect(document.querySelector('.stock-panel__value')?.textContent).toBe('17'),
    );
    expect(screen.getByText('+5')).toBeTruthy();
    expect(screen.getByText('caixa')).toBeTruthy();
    // o formulário do produto não foi tocado
    expect(field('Nome').value).toBe('Teclado Mecânico');
  });
});

describe('ProductFormPage: edição, carregamento e erros', () => {
  it('carregando: mensagem', async () => {
    let release!: (value: ReturnType<typeof detail>) => void;
    mockGet.mockReturnValue(new Promise((resolve) => (release = resolve)));
    renderPage();
    expect(screen.getAllByText('Carregando produto…').length).toBeGreaterThan(0);
    release(detail());
    await ready();
  });

  it('404: "Produto não encontrado" com link para a lista', async () => {
    mockGet.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'x'));
    renderPage();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Produto não encontrado' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Voltar à lista de produtos' }).getAttribute('href'),
    ).toBe('/admin/produtos');
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('erro de rede: "A API está fora do ar" e "Tentar de novo"', async () => {
    mockGet.mockRejectedValueOnce(new NetworkError()).mockRejectedValueOnce(new NetworkError());
    mockGet.mockRejectedValueOnce(new NetworkError());
    renderPage();
    expect((await screen.findByRole('alert', {}, { timeout: 4000 })).textContent).toContain(
      'A API está fora do ar.',
    );
    mockGet.mockResolvedValue(detail());
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    await ready();
  });
});
