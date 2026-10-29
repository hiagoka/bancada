import { useState } from 'react';
import { useLocation } from 'react-router';
import { ApiError, NetworkError } from '../../api/http';
import { Button, ButtonLink } from '../../components/Button';
import { ProductImage } from '../../components/ProductImage';
import { formatPrice } from '../../lib/format';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { AppLink } from '../../components/AppLink';
import { useAdminProducts } from './useAdminProducts';
import { useDebouncedValue } from './useDebouncedValue';
import './admin-products.css';

type ActiveFilter = 'all' | 'true' | 'false';

export function ProductsListPage() {
  useDocumentTitle('Produtos');
  // Aviso deixado pelo formulário depois de criar/editar (location.state).
  const notice = (useLocation().state as { notice?: string } | null)?.notice;
  const [search, setSearch] = useState('');
  const [active, setActive] = useState<ActiveFilter>('all');
  const q = useDebouncedValue(search.trim());
  const { data, error, isPending, isFetching, refetch } = useAdminProducts({ q, active });

  const filtered = q !== '' || active !== 'all';
  const count = data?.length ?? 0;

  return (
    <div className="container page admin-products">
      <div className="admin-products__head">
        <h1 className="page-title">Produtos</h1>
        <ButtonLink to="/admin/produtos/novo">Novo produto</ButtonLink>
      </div>

      {notice ? (
        <p role="status" className="admin-notice">
          {notice}
        </p>
      ) : null}

      <div className="admin-products__filters" role="search">
        <div className="field">
          <label htmlFor="products-search">Buscar por nome</label>
          <input
            id="products-search"
            type="search"
            autoComplete="off"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="products-active">Situação</label>
          <select
            id="products-active"
            value={active}
            onChange={(event) => setActive(event.target.value as ActiveFilter)}
          >
            <option value="all">Todos</option>
            <option value="true">Ativos</option>
            <option value="false">Inativos</option>
          </select>
        </div>
      </div>

      <p role="status" className="admin-products__count">
        {data ? `${count} ${count === 1 ? 'produto' : 'produtos'}` : ''}
        {isPending ? 'Carregando produtos…' : ''}
      </p>

      {error && !data ? (
        <div role="alert" className="login-alert">
          <p>
            <strong>
              {error instanceof NetworkError
                ? 'A API está fora do ar.'
                : error instanceof ApiError && error.status === 401
                  ? 'Sua sessão terminou.'
                  : 'Não foi possível carregar os produtos.'}
            </strong>{' '}
            Tente de novo em instantes.
          </p>
          <Button onClick={() => void refetch()} aria-disabled={isFetching}>
            {isFetching ? 'Tentando…' : 'Tentar de novo'}
          </Button>
        </div>
      ) : null}

      {data && data.length === 0 ? (
        <p>
          {filtered ? (
            'Nenhum produto encontrado.'
          ) : (
            <>
              Nenhum produto cadastrado ainda.{' '}
              <AppLink to="/admin/produtos/novo">Cadastrar o primeiro</AppLink>
            </>
          )}
        </p>
      ) : null}

      {data && data.length > 0 ? (
        <table className="admin-table">
          <thead>
            <tr>
              <th scope="col">Imagem</th>
              <th scope="col">Nome</th>
              <th scope="col">Categoria</th>
              <th scope="col" className="num">
                Preço
              </th>
              <th scope="col" className="num">
                Estoque
              </th>
              <th scope="col">Situação</th>
            </tr>
          </thead>
          <tbody>
            {data.map((product) => (
              <tr key={product.id}>
                <td data-label="Imagem">
                  <ProductImage product={product} className="admin-table__thumb" decorative />
                </td>
                <td data-label="Nome">
                  <AppLink to={`/admin/produtos/${product.id}`} className="admin-table__name">
                    {product.name}
                  </AppLink>
                </td>
                <td data-label="Categoria">{product.category}</td>
                <td data-label="Preço" className="num mono">
                  {formatPrice(product.priceCents)}
                </td>
                <td data-label="Estoque" className="num mono">
                  {product.stock}
                </td>
                <td data-label="Situação">
                  <span className={`tag ${product.active ? 'tag--ok' : 'tag--off'}`}>
                    {product.active ? 'Ativo' : 'Inativo'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
