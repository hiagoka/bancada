import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Sem proxy: a API tem CORS para WEB_URL (http://localhost:5173) com credentials.
export default defineConfig({
  plugins: [react()],
  // host: true escuta em IPv4 e IPv6 (o padrão 'localhost' pode ficar só em ::1 e o navegador
  // tentar 127.0.0.1). Em dev isso também expõe o servidor na rede local.
  server: { host: true, port: 5173, strictPort: true },
  preview: { host: true, port: 5173, strictPort: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Os testes usam o código-fonte do contracts: não dependem de ele estar compilado.
    alias: {
      '@bancada/contracts': resolve(import.meta.dirname, '../../packages/contracts/src/index.ts'),
    },
  },
});
