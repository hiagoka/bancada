import { MAX_ORDER_ITEM_QUANTITY, productSchema, type Product } from '@bancada/contracts';
import { create } from 'zustand';
import { persist, type PersistStorage } from 'zustand/middleware';

export const CART_STORAGE_KEY = 'bancada-cart';
const CART_VERSION = 1;

export interface CartLine {
  // Snapshot do produto no momento em que entrou no carrinho (atualizado por syncWithCatalog).
  product: Product;
  quantity: number;
}

// Aviso sobre algo que o syncWithCatalog ajustou no carrinho.
export interface CartChange {
  kind: 'removed' | 'out_of_stock' | 'reduced' | 'price_changed';
  productId: string;
  productName: string;
  // reduced: quantidade antes/depois. price_changed: preço (centavos) antes/depois.
  from?: number;
  to?: number;
}

export interface CartState {
  lines: CartLine[];
  // Avisos do último(s) sync; em memória, NÃO são persistidos.
  notices: CartChange[];
  // Devolve quantas unidades entraram (0 se já estava no estoque máximo, sem estoque ou inválido).
  add: (product: Product, quantity?: number) => number;
  // 0 ou negativo remove; acima do estoque limita ao estoque.
  setQuantity: (productId: string, quantity: number) => void;
  remove: (productId: string) => void;
  clear: () => void;
  syncWithCatalog: (products: Product[]) => CartChange[];
  dismissNotices: () => void;
}

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

interface PersistedCart {
  lines: CartLine[];
}

// Quantidade máxima de um produto no carrinho: o estoque, mas nunca mais que o limite por item
// que a API aceita (999; acima disso o pedido seria recusado com 400).
export const maxQuantityFor = (product: Pick<Product, 'stock'>): number =>
  Math.min(product.stock, MAX_ORDER_ITEM_QUANTITY);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isPositiveInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1;

// Valida o que veio do localStorage (pode estar corrompido ou ter sido editado à mão): descarta
// linhas inválidas, limita ao estoque salvo, junta duplicatas. Nunca lança.
export function sanitizeLines(raw: unknown): CartLine[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map<string, CartLine>();
  for (const item of raw as unknown[]) {
    if (!isRecord(item) || !isPositiveInt(item.quantity)) continue;
    const product = productSchema.safeParse(item.product);
    if (!product.success || product.data.stock < 1) continue;
    const existing = byId.get(product.data.id);
    const quantity = Math.min(
      (existing?.quantity ?? 0) + item.quantity,
      maxQuantityFor(product.data),
    );
    byId.set(product.data.id, { product: existing?.product ?? product.data, quantity });
  }
  return [...byId.values()];
}

// localStorage pode lançar (modo privado, bloqueado, cota cheia): tudo em try/catch.
function createSafeStorage(storage: StorageLike | undefined): PersistStorage<PersistedCart> {
  return {
    getItem: (name) => {
      try {
        const raw = storage?.getItem(name);
        if (raw === null || raw === undefined) return null;
        const parsed: unknown = JSON.parse(raw);
        if (!isRecord(parsed) || !isRecord(parsed.state)) return null;
        return {
          state: { lines: sanitizeLines(parsed.state.lines) },
          version: typeof parsed.version === 'number' ? parsed.version : -1,
        };
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      try {
        storage?.setItem(name, JSON.stringify(value));
      } catch {
        // Cota cheia ou storage bloqueado: o carrinho segue funcionando em memória.
      }
    },
    removeItem: (name) => {
      try {
        storage?.removeItem(name);
      } catch {
        // idem
      }
    },
  };
}

function sameProduct(a: Product, b: Product): boolean {
  return (
    a.id === b.id &&
    a.slug === b.slug &&
    a.name === b.name &&
    a.description === b.description &&
    a.category === b.category &&
    a.priceCents === b.priceCents &&
    a.stock === b.stock &&
    a.imageUrl === b.imageUrl
  );
}

export function createCartStore(storage: StorageLike | undefined) {
  return create<CartState>()(
    persist(
      (set, get) => ({
        lines: [],
        notices: [],

        add: (product, quantity = 1) => {
          if (!isPositiveInt(quantity) || product.stock < 1) return 0;
          const { lines } = get();
          const existing = lines.find((line) => line.product.id === product.id);
          const current = existing?.quantity ?? 0;
          const next = Math.min(current + quantity, maxQuantityFor(product));
          const added = next - current;
          if (added <= 0) return 0;
          set({
            lines: existing
              ? lines.map((line) =>
                  line.product.id === product.id ? { product, quantity: next } : line,
                )
              : [...lines, { product, quantity: next }],
          });
          return added;
        },

        setQuantity: (productId, quantity) => {
          if (!Number.isFinite(quantity)) return;
          const { lines } = get();
          const line = lines.find((l) => l.product.id === productId);
          if (!line) return;
          const wanted = Math.floor(quantity);
          if (wanted < 1) {
            set({ lines: lines.filter((l) => l.product.id !== productId) });
            return;
          }
          const next = Math.min(wanted, maxQuantityFor(line.product));
          if (next === line.quantity) return;
          set({
            lines: lines.map((l) => (l.product.id === productId ? { ...l, quantity: next } : l)),
          });
        },

        remove: (productId) => {
          set({ lines: get().lines.filter((l) => l.product.id !== productId) });
        },

        clear: () => set({ lines: [] }),

        syncWithCatalog: (products) => {
          const catalog = new Map(products.map((p) => [p.id, p]));
          const changes: CartChange[] = [];
          const nextLines: CartLine[] = [];
          let dirty = false;

          for (const line of get().lines) {
            const fresh = catalog.get(line.product.id);
            const base = { productId: line.product.id, productName: line.product.name };
            if (!fresh) {
              changes.push({ kind: 'removed', ...base });
              dirty = true;
              continue;
            }
            if (fresh.stock < 1) {
              changes.push({ kind: 'out_of_stock', ...base, productName: fresh.name });
              dirty = true;
              continue;
            }
            const quantity = Math.min(line.quantity, maxQuantityFor(fresh));
            if (quantity !== line.quantity) {
              changes.push({
                kind: 'reduced',
                ...base,
                productName: fresh.name,
                from: line.quantity,
                to: quantity,
              });
            }
            if (fresh.priceCents !== line.product.priceCents) {
              changes.push({
                kind: 'price_changed',
                ...base,
                productName: fresh.name,
                from: line.product.priceCents,
                to: fresh.priceCents,
              });
            }
            if (quantity !== line.quantity || !sameProduct(line.product, fresh)) dirty = true;
            nextLines.push({ product: fresh, quantity });
          }

          if (!dirty) return [];
          set((state) => ({
            lines: nextLines,
            notices: changes.length > 0 ? [...state.notices, ...changes] : state.notices,
          }));
          return changes;
        },

        dismissNotices: () => set({ notices: [] }),
      }),
      {
        name: CART_STORAGE_KEY,
        version: CART_VERSION,
        storage: createSafeStorage(storage),
        // Só as linhas vão para o storage (nada de ações nem avisos).
        partialize: (state): PersistedCart => ({ lines: state.lines }),
        // Versão diferente da atual: descarta em vez de arriscar um formato antigo.
        migrate: (): PersistedCart => ({ lines: [] }),
        merge: (persisted, current) => ({
          ...current,
          lines: sanitizeLines(isRecord(persisted) ? persisted.lines : undefined),
        }),
      },
    ),
  );
}

function browserStorage(): StorageLike | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined; // acessar window.localStorage também pode lançar
  }
}

export const useCartStore = createCartStore(browserStorage());

// Duas abas abertas: o evento `storage` dispara na OUTRA aba quando uma muda o carrinho; relê o
// storage para as duas não divergirem.
export function syncAcrossTabs(
  store: ReturnType<typeof createCartStore>,
  target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>,
): () => void {
  const onStorage = (event: Event): void => {
    if ((event as StorageEvent).key === CART_STORAGE_KEY) void store.persist.rehydrate();
  };
  target.addEventListener('storage', onStorage);
  return () => target.removeEventListener('storage', onStorage);
}

if (typeof window !== 'undefined') syncAcrossTabs(useCartStore, window);

// Seletores finos: devolvem primitivos, então o componente só re-renderiza quando o valor muda.
export const selectTotalItems = (state: CartState): number =>
  state.lines.reduce((total, line) => total + line.quantity, 0);

export const selectSubtotalCents = (state: CartState): number =>
  state.lines.reduce((total, line) => total + line.product.priceCents * line.quantity, 0);

export const selectQuantityOf =
  (productId: string) =>
  (state: CartState): number =>
    state.lines.find((line) => line.product.id === productId)?.quantity ?? 0;
