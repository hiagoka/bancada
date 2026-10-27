import { afterEach } from 'vitest';

// Node 25+ expõe um `localStorage` experimental (sem arquivo configurado) que sombreia o do
// jsdom e não tem clear(). Nos testes de jsdom, garante um Storage em memória que funciona.
if (typeof document !== 'undefined') {
  const makeMemoryStorage = (): Storage => {
    const data = new Map<string, string>();
    return {
      get length() {
        return data.size;
      },
      clear: () => data.clear(),
      getItem: (key) => data.get(key) ?? null,
      key: (index) => [...data.keys()][index] ?? null,
      removeItem: (key) => void data.delete(key),
      setItem: (key, value) => void data.set(key, String(value)),
    };
  };
  const memory = makeMemoryStorage();
  const session = makeMemoryStorage();
  // Instala sem ler o getter nativo (ler dispara o aviso do Node sobre --localstorage-file).
  Object.defineProperty(window, 'localStorage', { value: memory, configurable: true });
  Object.defineProperty(globalThis, 'localStorage', { value: memory, configurable: true });
  Object.defineProperty(window, 'sessionStorage', { value: session, configurable: true });
  Object.defineProperty(globalThis, 'sessionStorage', { value: session, configurable: true });
}

// Testes de componente (jsdom): desmonta a árvore entre os testes. Nos de node, não faz nada.
afterEach(async () => {
  if (typeof document === 'undefined') return;
  const { cleanup } = await import('@testing-library/react');
  cleanup();
});
