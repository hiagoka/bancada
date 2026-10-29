import { useEffect, useRef } from 'react';

// Falha ao salvar: região role="alert" que recebe o foco a cada nova tentativa (attempt muda).
export function FormAlert({ message, attempt }: { message: string; attempt: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [attempt]);
  return (
    <div ref={ref} role="alert" tabIndex={-1} className="login-alert">
      <p>{message}</p>
    </div>
  );
}
