import type { Admin } from '@bancada/contracts';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, Navigate, RouterProvider, useLocation } from 'react-router';
import { createQueryClient } from '../app/queryClient';
import { AdminLayout, AdminLoginLayout } from '../features/admin/AdminLayout';
import { LoginPage } from '../features/admin/LoginPage';
import { RequireAdmin } from '../features/admin/RequireAdmin';

export const ADMIN: Admin = {
  id: '6ba7b810-9dad-41d1-80b5-00c04fd430c8',
  email: 'ana@bancada.test',
  name: 'Ana Admin',
};

// Mostra o caminho atual para os testes conferirem redirecionamentos.
export function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname + location.search}</p>;
}

// As mesmas rotas do app, com páginas de mentira no lugar de produtos e pedidos.
export function renderAdmin(initialUrl: string, client: QueryClient = createQueryClient()) {
  const router = createMemoryRouter(
    [
      { path: '/', element: <p>LOJA</p> },
      {
        path: 'admin/login',
        element: <AdminLoginLayout />,
        children: [{ index: true, element: <LoginPage /> }],
      },
      {
        path: 'admin',
        element: <RequireAdmin />,
        children: [
          {
            element: <AdminLayout />,
            children: [
              { index: true, element: <Navigate to="/admin/produtos" replace /> },
              { path: 'produtos', element: <h1>PRODUTOS</h1> },
              { path: 'pedidos', element: <h1>PEDIDOS</h1> },
            ],
          },
        ],
      },
    ],
    { initialEntries: [initialUrl] },
  );
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  const where = (): string => router.state.location.pathname + router.state.location.search;
  return { ...view, client, router, where };
}
