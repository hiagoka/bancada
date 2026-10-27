import { Navigate, createBrowserRouter } from 'react-router';
import { Layout } from '../components/Layout';
import { AdminLayout } from '../features/admin/AdminLayout';
import { LoginPage } from '../features/admin/LoginPage';
import { OrdersListPage } from '../features/admin/OrdersListPage';
import { ProductFormPage } from '../features/admin/ProductFormPage';
import { ProductsListPage } from '../features/admin/ProductsListPage';
import { CartPage } from '../features/cart/CartPage';
import { CatalogPage } from '../features/catalog/CatalogPage';
import { FakeCheckoutPage } from '../features/orders/FakeCheckoutPage';
import { OrderPage } from '../features/orders/OrderPage';
import { NotFoundPage } from './NotFoundPage';

export const routes = [
  {
    // Loja (e o login do admin, que não usa o AdminLayout).
    element: <Layout />,
    children: [
      { index: true, element: <CatalogPage /> },
      { path: 'carrinho', element: <CartPage /> },
      { path: 'pedido/:id', element: <OrderPage /> },
      { path: 'checkout-simulado/:id', element: <FakeCheckoutPage /> },
      { path: 'admin/login', element: <LoginPage /> },
    ],
  },
  {
    // Admin (a T17 adiciona o RequireAdmin em volta).
    path: 'admin',
    element: <AdminLayout />,
    children: [
      { index: true, element: <Navigate to="/admin/produtos" replace /> },
      { path: 'produtos', element: <ProductsListPage /> },
      { path: 'produtos/novo', element: <ProductFormPage /> },
      { path: 'produtos/:id', element: <ProductFormPage /> },
      { path: 'pedidos', element: <OrdersListPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  {
    element: <Layout />,
    children: [{ path: '*', element: <NotFoundPage /> }],
  },
];

export const router = createBrowserRouter(routes);
