import { MAX_ORDER_ITEM_QUANTITY } from '@bancada/contracts';
import { describe, expect, it } from 'vitest';
import { MemoryStorage, makeProduct } from '../../test/fixtures';
import {
  CART_STORAGE_KEY,
  createCartStore,
  sanitizeLines,
  selectQuantityOf,
  selectSubtotalCents,
  selectTotalItems,
  maxQuantityFor,
  syncAcrossTabs,
} from './cartStore';

const fresh = () => {
  const storage = new MemoryStorage();
  return { storage, store: createCartStore(storage) };
};

describe('add', () => {
  it('cria a linha com quantidade 1 e devolve quanto foi adicionado', () => {
    const { store } = fresh();
    const product = makeProduct({ stock: 5 });
    expect(store.getState().add(product)).toBe(1);
    expect(store.getState().lines).toEqual([{ product, quantity: 1 }]);
  });

  it('soma na linha existente e NUNCA passa do estoque', () => {
    const { store } = fresh();
    const product = makeProduct({ stock: 3 });
    expect(store.getState().add(product)).toBe(1);
    expect(store.getState().add(product)).toBe(1);
    expect(store.getState().add(product)).toBe(1);
    expect(store.getState().add(product)).toBe(0); // já no máximo
    expect(store.getState().lines[0]?.quantity).toBe(3);
  });

  it('com quantidade explícita, limita ao que falta para o estoque', () => {
    const { store } = fresh();
    const product = makeProduct({ stock: 4 });
    expect(store.getState().add(product, 3)).toBe(3);
    expect(store.getState().add(product, 3)).toBe(1);
    expect(store.getState().lines[0]?.quantity).toBe(4);
  });

  it('produto sem estoque não entra no carrinho', () => {
    const { store } = fresh();
    expect(store.getState().add(makeProduct({ stock: 0 }))).toBe(0);
    expect(store.getState().lines).toEqual([]);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'quantidade inválida (%p) é ignorada',
    (quantity) => {
      const { store } = fresh();
      expect(store.getState().add(makeProduct(), quantity)).toBe(0);
      expect(store.getState().lines).toEqual([]);
    },
  );

  it('atualiza o snapshot do produto (preço/estoque) ao adicionar de novo', () => {
    const { store } = fresh();
    const product = makeProduct({ stock: 5, priceCents: 1000 });
    store.getState().add(product);
    store.getState().add({ ...product, priceCents: 1200, stock: 5 });
    expect(store.getState().lines[0]?.product.priceCents).toBe(1200);
  });

  it('linhas de produtos diferentes ficam separadas, na ordem de inclusão', () => {
    const { store } = fresh();
    const a = makeProduct();
    const b = makeProduct();
    store.getState().add(b);
    store.getState().add(a);
    expect(store.getState().lines.map((l) => l.product.id)).toEqual([b.id, a.id]);
  });
});

describe('setQuantity', () => {
  const setup = (stock = 5, quantity = 2) => {
    const ctx = fresh();
    const product = makeProduct({ stock });
    ctx.store.getState().add(product, quantity);
    return { ...ctx, product };
  };

  it('define a quantidade dentro do estoque', () => {
    const { store, product } = setup();
    store.getState().setQuantity(product.id, 4);
    expect(selectQuantityOf(product.id)(store.getState())).toBe(4);
  });

  it('acima do estoque: limita ao estoque', () => {
    const { store, product } = setup(5);
    store.getState().setQuantity(product.id, 99);
    expect(store.getState().lines[0]?.quantity).toBe(5);
  });

  it.each([0, -1, -100])('quantidade %p remove a linha', (quantity) => {
    const { store, product } = setup();
    store.getState().setQuantity(product.id, quantity);
    expect(store.getState().lines).toEqual([]);
  });

  it('NaN/Infinity são ignorados (a linha continua como estava)', () => {
    const { store, product } = setup(5, 2);
    store.getState().setQuantity(product.id, Number.NaN);
    store.getState().setQuantity(product.id, Number.POSITIVE_INFINITY);
    expect(store.getState().lines[0]?.quantity).toBe(2);
  });

  it('quantidade fracionada é arredondada para baixo', () => {
    const { store, product } = setup();
    store.getState().setQuantity(product.id, 3.9);
    expect(store.getState().lines[0]?.quantity).toBe(3);
  });

  it('id desconhecido não faz nada', () => {
    const { store } = setup();
    const before = store.getState().lines;
    store.getState().setQuantity('00000000-0000-4000-8000-000000000000', 3);
    expect(store.getState().lines).toBe(before);
  });
});

describe('remove, clear e seletores', () => {
  it('remove e clear', () => {
    const { store } = fresh();
    const a = makeProduct();
    const b = makeProduct();
    store.getState().add(a);
    store.getState().add(b);
    store.getState().remove(a.id);
    expect(store.getState().lines.map((l) => l.product.id)).toEqual([b.id]);
    store.getState().clear();
    expect(store.getState().lines).toEqual([]);
  });

  it('contador total e subtotal em centavos (inteiros)', () => {
    const { store } = fresh();
    store.getState().add(makeProduct({ priceCents: 34990, stock: 9 }), 2);
    store.getState().add(makeProduct({ priceCents: 4900, stock: 9 }), 3);
    expect(selectTotalItems(store.getState())).toBe(5);
    expect(selectSubtotalCents(store.getState())).toBe(2 * 34990 + 3 * 4900);
  });

  it('carrinho vazio: contador 0 e subtotal 0', () => {
    const { store } = fresh();
    expect(selectTotalItems(store.getState())).toBe(0);
    expect(selectSubtotalCents(store.getState())).toBe(0);
  });

  it('o seletor do contador é um primitivo estável (não re-renderiza à toa)', () => {
    const { store } = fresh();
    const product = makeProduct({ stock: 5 });
    store.getState().add(product, 2);
    const before = selectTotalItems(store.getState());
    store.getState().add(makeProduct({ stock: 1 }), 0); // ignorado
    expect(Object.is(before, selectTotalItems(store.getState()))).toBe(true);
  });
});

describe('persistência (localStorage)', () => {
  it("grava em 'bancada-cart' com version 1 a cada mudança", () => {
    const { store, storage } = fresh();
    const product = makeProduct({ stock: 5 });
    store.getState().add(product, 2);
    const saved = JSON.parse(storage.getItem(CART_STORAGE_KEY) ?? 'null');
    expect(saved.version).toBe(1);
    expect(saved.state.lines).toEqual([{ product, quantity: 2 }]);
    expect(Object.keys(saved.state)).toEqual(['lines']); // notices e ações não são persistidos
  });

  it('um novo store com o mesmo storage reidrata o carrinho (F5)', () => {
    const { store, storage } = fresh();
    const product = makeProduct({ stock: 5 });
    store.getState().add(product, 3);
    const reloaded = createCartStore(storage);
    expect(reloaded.getState().lines).toEqual([{ product, quantity: 3 }]);
  });

  it('clear também é persistido', () => {
    const { store, storage } = fresh();
    store.getState().add(makeProduct());
    store.getState().clear();
    expect(createCartStore(storage).getState().lines).toEqual([]);
  });

  it('sem storage (ambiente sem localStorage): funciona só em memória', () => {
    const store = createCartStore(undefined);
    store.getState().add(makeProduct({ stock: 2 }));
    expect(store.getState().lines).toHaveLength(1);
  });
});

describe('hidratação robusta', () => {
  const seed = (raw: string) => {
    const storage = new MemoryStorage();
    storage.setItem(CART_STORAGE_KEY, raw);
    return storage;
  };
  const wrap = (lines: unknown, version = 1) => JSON.stringify({ state: { lines }, version });

  it.each([
    ['JSON inválido', '{nao-e-json'],
    ['string vazia', ''],
    ['null', 'null'],
    ['número', '42'],
    ['array', '[1,2,3]'],
    ['objeto sem state', '{"version":1}'],
    ['state sem lines', '{"state":{},"version":1}'],
    ['lines que não é array', wrap('lixo')],
  ])('%s: carrinho vazio, sem quebrar', (_name, raw) => {
    expect(() => createCartStore(seed(raw))).not.toThrow();
    expect(createCartStore(seed(raw)).getState().lines).toEqual([]);
  });

  it('versão diferente da 1: descarta', () => {
    const product = makeProduct();
    expect(createCartStore(seed(wrap([{ product, quantity: 1 }], 99))).getState().lines).toEqual(
      [],
    );
  });

  it('mantém as linhas válidas e descarta o lixo no meio', () => {
    const good = makeProduct({ stock: 5 });
    const lines = [
      { product: good, quantity: 2 },
      null,
      'texto',
      { product: { id: 'x' }, quantity: 1 },
      { product: { ...makeProduct(), priceCents: -5 }, quantity: 1 },
      { product: { ...makeProduct(), priceCents: 10.5 }, quantity: 1 },
      { product: makeProduct(), quantity: 1.5 },
      { product: makeProduct(), quantity: -2 },
      { product: makeProduct(), quantity: 'dois' },
      { product: makeProduct() },
    ];
    expect(createCartStore(seed(wrap(lines))).getState().lines).toEqual([
      { product: good, quantity: 2 },
    ]);
  });

  it('quantidade acima do estoque salvo é limitada; sem estoque é descartada', () => {
    const limited = makeProduct({ stock: 3 });
    const soldOut = makeProduct({ stock: 0 });
    const state = createCartStore(
      seed(
        wrap([
          { product: limited, quantity: 99 },
          { product: soldOut, quantity: 1 },
        ]),
      ),
    ).getState();
    expect(state.lines).toEqual([{ product: limited, quantity: 3 }]);
  });

  it('linhas duplicadas do mesmo produto viram uma só (soma limitada ao estoque)', () => {
    const product = makeProduct({ stock: 4 });
    const state = createCartStore(
      seed(
        wrap([
          { product, quantity: 3 },
          { product, quantity: 3 },
        ]),
      ),
    ).getState();
    expect(state.lines).toEqual([{ product, quantity: 4 }]);
  });

  it('campos extras do produto são descartados pelo schema', () => {
    const product = makeProduct({ stock: 5 });
    const polluted = { ...product, admin: true, active: false };
    const [line] = createCartStore(seed(wrap([{ product: polluted, quantity: 1 }]))).getState()
      .lines;
    expect(line?.product).toEqual(product);
  });

  it('getItem lançando (storage bloqueado): não quebra e começa vazio', () => {
    const storage = {
      getItem: () => {
        throw new DOMException('bloqueado', 'SecurityError');
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    const store = createCartStore(storage);
    expect(store.getState().lines).toEqual([]);
    store.getState().add(makeProduct());
    expect(store.getState().lines).toHaveLength(1);
  });

  it('setItem lançando (cota cheia): o carrinho em memória continua funcionando', () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('cheio', 'QuotaExceededError');
      },
      removeItem: () => undefined,
    };
    const store = createCartStore(storage);
    expect(() => store.getState().add(makeProduct({ stock: 3 }), 2)).not.toThrow();
    expect(selectTotalItems(store.getState())).toBe(2);
  });

  it('sanitizeLines aceita qualquer coisa sem lançar', () => {
    for (const input of [undefined, null, 1, 'a', {}, [], [[]], [{}], [{ product: 1 }]]) {
      expect(() => sanitizeLines(input)).not.toThrow();
      expect(sanitizeLines(input)).toEqual([]);
    }
  });
});

describe('syncWithCatalog', () => {
  it('(1) produto que sumiu do catálogo é removido, com aviso', () => {
    const { store } = fresh();
    const gone = makeProduct();
    const kept = makeProduct();
    store.getState().add(gone);
    store.getState().add(kept);
    const changes = store.getState().syncWithCatalog([kept]);
    expect(store.getState().lines.map((l) => l.product.id)).toEqual([kept.id]);
    expect(changes).toEqual([
      expect.objectContaining({ kind: 'removed', productId: gone.id, productName: gone.name }),
    ]);
    expect(store.getState().notices).toEqual(changes);
  });

  it('(2) produto que ficou sem estoque é removido, com aviso', () => {
    const { store } = fresh();
    const product = makeProduct({ stock: 4 });
    store.getState().add(product, 2);
    const changes = store.getState().syncWithCatalog([{ ...product, stock: 0 }]);
    expect(store.getState().lines).toEqual([]);
    expect(changes).toEqual([
      expect.objectContaining({ kind: 'out_of_stock', productId: product.id }),
    ]);
  });

  it('(3) quantidade acima do estoque atual é reduzida, com aviso (de/para)', () => {
    const { store } = fresh();
    const product = makeProduct({ stock: 9 });
    store.getState().add(product, 6);
    const changes = store.getState().syncWithCatalog([{ ...product, stock: 2 }]);
    expect(store.getState().lines[0]).toEqual({ product: { ...product, stock: 2 }, quantity: 2 });
    expect(changes).toEqual([
      expect.objectContaining({ kind: 'reduced', productId: product.id, from: 6, to: 2 }),
    ]);
  });

  it('(4) atualiza nome, preço e estoque do snapshot; mudança de preço avisa', () => {
    const { store } = fresh();
    const product = makeProduct({ stock: 9, priceCents: 1000, name: 'Antigo' });
    store.getState().add(product, 2);
    const updated = { ...product, name: 'Novo nome', priceCents: 1500, stock: 8 };
    const changes = store.getState().syncWithCatalog([updated]);
    expect(store.getState().lines[0]).toEqual({ product: updated, quantity: 2 });
    expect(changes).toEqual([
      expect.objectContaining({ kind: 'price_changed', from: 1000, to: 1500 }),
    ]);
  });

  it('sem nenhuma diferença: não avisa e não troca as linhas (sem re-render)', () => {
    const { store } = fresh();
    const product = makeProduct({ stock: 5 });
    store.getState().add(product, 2);
    const before = store.getState().lines;
    expect(store.getState().syncWithCatalog([product])).toEqual([]);
    expect(store.getState().lines).toBe(before);
    expect(store.getState().notices).toEqual([]);
  });

  it('catálogo vazio remove tudo (ex.: loja sem produtos)', () => {
    const { store } = fresh();
    store.getState().add(makeProduct());
    store.getState().syncWithCatalog([]);
    expect(store.getState().lines).toEqual([]);
  });

  it('o resultado do sync é persistido e os avisos NÃO', () => {
    const { store, storage } = fresh();
    const product = makeProduct({ stock: 9 });
    store.getState().add(product, 6);
    store.getState().syncWithCatalog([{ ...product, stock: 2 }]);
    const reloaded = createCartStore(storage);
    expect(reloaded.getState().lines[0]?.quantity).toBe(2);
    expect(reloaded.getState().notices).toEqual([]);
  });

  it('dismissNotices limpa os avisos', () => {
    const { store } = fresh();
    store.getState().add(makeProduct());
    store.getState().syncWithCatalog([]);
    expect(store.getState().notices).toHaveLength(1);
    store.getState().dismissNotices();
    expect(store.getState().notices).toEqual([]);
  });
});

describe('limite por item da API (999)', () => {
  const big = () => makeProduct({ stock: 5000 });

  it('maxQuantityFor = min(estoque, 999)', () => {
    expect(maxQuantityFor({ stock: 5000 })).toBe(MAX_ORDER_ITEM_QUANTITY);
    expect(maxQuantityFor({ stock: 3 })).toBe(3);
  });

  it('add e setQuantity nunca passam de 999, mesmo com estoque maior', () => {
    const { store } = fresh();
    const product = big();
    expect(store.getState().add(product, 2000)).toBe(999);
    expect(store.getState().add(product)).toBe(0);
    store.getState().setQuantity(product.id, 5000);
    expect(store.getState().lines[0]?.quantity).toBe(999);
  });

  it('a hidratação e o sync também respeitam o limite', () => {
    const product = big();
    const storage = new MemoryStorage();
    storage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify({ state: { lines: [{ product, quantity: 4000 }] }, version: 1 }),
    );
    const store = createCartStore(storage);
    expect(store.getState().lines[0]?.quantity).toBe(999);
    store.getState().syncWithCatalog([product]);
    expect(store.getState().lines[0]?.quantity).toBe(999);
  });
});

describe('várias abas (evento storage)', () => {
  it('rehidrata quando OUTRA aba muda o carrinho e ignora outras chaves', () => {
    const storage = new MemoryStorage();
    const store = createCartStore(storage);
    const target = new EventTarget();
    const stop = syncAcrossTabs(store, target);

    const other = createCartStore(storage); // "outra aba" gravando no mesmo storage
    const product = makeProduct({ stock: 5 });
    other.getState().add(product, 2);
    expect(store.getState().lines).toEqual([]);

    target.dispatchEvent(Object.assign(new Event('storage'), { key: 'outra-chave' }));
    expect(store.getState().lines).toEqual([]);
    target.dispatchEvent(Object.assign(new Event('storage'), { key: CART_STORAGE_KEY }));
    expect(store.getState().lines).toEqual([{ product, quantity: 2 }]);

    stop();
    other.getState().add(product, 1);
    target.dispatchEvent(Object.assign(new Event('storage'), { key: CART_STORAGE_KEY }));
    expect(store.getState().lines[0]?.quantity).toBe(2); // listener removido
  });
});
