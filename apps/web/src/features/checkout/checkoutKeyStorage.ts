export const CHECKOUT_KEY_STORAGE_KEY = 'bancada-checkout-key';

// A chave só vale por 25 minutos: abaixo dos 30 da D19 (expiração do pedido/Preference). Uma chave
// mais velha poderia, num replay, devolver um pedido que já expirou ou foi cancelado.
export const MAX_KEY_AGE_MS = 25 * 60 * 1000;

export interface SavedCheckoutKey {
  // Hash (FNV-1a 64) da assinatura do pedido: o storage NUNCA guarda nome, e-mail ou itens legíveis.
  signatureHash: string;
  key: string;
  savedAt: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{16}$/;
// Tolerância para relógio adiantado: savedAt no futuro além disso é lixo.
const FUTURE_SLACK_MS = 60_000;

// sessionStorage pode lançar (modo privado, bloqueado, cota cheia) ou nem existir: TODO acesso fica
// em try/catch e o checkout continua funcionando só com a chave em memória (useRef).
function storage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : (window.sessionStorage ?? undefined);
  } catch {
    return undefined;
  }
}

export function isFresh(savedAt: number, now: number): boolean {
  return (
    Number.isFinite(savedAt) && now - savedAt <= MAX_KEY_AGE_MS && savedAt - now <= FUTURE_SLACK_MS
  );
}

// Lê a chave salva. Fora do formato, velha demais ou ilegível vira null (e a entrada é apagada).
export function readSavedKey(now: number): SavedCheckoutKey | null {
  try {
    const raw = storage()?.getItem(CHECKOUT_KEY_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const { signatureHash, key, savedAt } = parsed as Record<string, unknown>;
    if (
      typeof signatureHash !== 'string' ||
      !HASH.test(signatureHash) ||
      typeof key !== 'string' ||
      !UUID.test(key) ||
      typeof savedAt !== 'number'
    ) {
      return null;
    }
    if (!isFresh(savedAt, now)) {
      clearSavedKey();
      return null;
    }
    return { signatureHash, key, savedAt };
  } catch {
    return null;
  }
}

export function saveKey(entry: SavedCheckoutKey): void {
  try {
    storage()?.setItem(CHECKOUT_KEY_STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // Sem storage: segue só com a chave em memória.
  }
}

export function clearSavedKey(): void {
  try {
    storage()?.removeItem(CHECKOUT_KEY_STORAGE_KEY);
  } catch {
    // idem
  }
}
