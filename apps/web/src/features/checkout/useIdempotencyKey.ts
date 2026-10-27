import { useEffect, useRef } from 'react';
import { fnv1a64Hex } from '../../lib/hash';
import { newIdempotencyKey } from '../../lib/idempotency';
import { useCartStore } from '../cart/cartStore';
import {
  clearSavedKey,
  isFresh,
  readSavedKey,
  saveKey,
  type SavedCheckoutKey,
} from './checkoutKeyStorage';

// A chave vive em useRef durante a sessão da página E também em sessionStorage (como HASH da
// assinatura + hora): se a resposta se perde (rede, F5) ou a pessoa sai da tela e volta, o retry
// reusa a MESMA chave (a API devolve o pedido já criado em vez de reservar o estoque em dobro).
// Só vale para a MESMA assinatura (carrinho + nome/e-mail normalizados) e por até 25 minutos;
// qualquer outra situação gera chave nova e substitui a salva.
export function useIdempotencyKey(now: () => number = Date.now) {
  const ref = useRef<SavedCheckoutKey | null>(null);

  const forget = (): void => {
    ref.current = null;
    clearSavedKey();
  };

  // Carrinho que esvazia (desistiu, ajustou até zero, comprou): não sobra entrada no storage.
  useEffect(
    () =>
      useCartStore.subscribe((state, previous) => {
        if (previous.lines.length > 0 && state.lines.length === 0) forget();
      }),
    [],
  );

  const create = (signatureHash: string): string => {
    const entry = { signatureHash, key: newIdempotencyKey(), savedAt: now() };
    ref.current = entry;
    saveKey(entry);
    return entry.key;
  };

  return {
    keyFor(signature: string): string {
      const signatureHash = fnv1a64Hex(signature);
      const current = ref.current;
      if (current?.signatureHash === signatureHash && isFresh(current.savedAt, now())) {
        return current.key;
      }
      const stored = readSavedKey(now());
      if (stored?.signatureHash === signatureHash) {
        ref.current = stored;
        return stored.key;
      }
      return create(signatureHash);
    },
    // Esquece a chave (memória e storage): pedido concluído ou encerrado. A próxima tentativa
    // cria outra.
    renew: forget,
    // Renovação FORÇADA (expired, IDEMPOTENCY_KEY_REUSED): já gera e grava a chave nova.
    rotate(signature: string): void {
      create(fnv1a64Hex(signature));
    },
  };
}
