import { useEffect, useState } from 'react';

// Valor que só "assenta" depois de `delayMs` sem mudar (busca digitada: uma consulta, não uma por tecla).
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
