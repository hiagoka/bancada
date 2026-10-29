import { useParams } from 'react-router';
import { ApiError, NetworkError } from '../../api/http';
import { Button, ButtonLink } from '../../components/Button';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { ProductCreateForm } from './ProductCreateForm';
import { ProductEditForm } from './ProductEditForm';
import { useAdminProduct } from './useAdminProducts';
import './admin-products.css';

// Serve /admin/produtos/novo e /admin/produtos/:id.
export function ProductFormPage() {
  const { id } = useParams();
  return id ? <EditLoader id={id} /> : <ProductCreateForm />;
}

function EditLoader({ id }: { id: string }) {
  const { data, error, isPending, isFetching, refetch } = useAdminProduct(id);
  const notFound = error instanceof ApiError && error.status === 404;
  useDocumentTitle(notFound ? 'Produto não encontrado' : 'Editar produto');

  if (data) return <ProductEditForm key={data.id} product={data} />;

  return (
    <div className="container page admin-products">
      {isPending ? (
        <>
          <h1 className="page-title">Editar produto</h1>
          <p role="status">Carregando produto…</p>
        </>
      ) : null}

      {error && notFound ? (
        <>
          <h1 className="page-title">Produto não encontrado</h1>
          <p>Ele pode ter sido removido ou o endereço está errado.</p>
          <ButtonLink to="/admin/produtos">Voltar à lista de produtos</ButtonLink>
        </>
      ) : null}

      {error && !notFound ? (
        <>
          <h1 className="page-title">Editar produto</h1>
          <div role="alert" className="login-alert">
            <p>
              <strong>
                {error instanceof NetworkError
                  ? 'A API está fora do ar.'
                  : 'Não foi possível carregar o produto.'}
              </strong>{' '}
              Tente de novo em instantes.
            </p>
            <Button onClick={() => void refetch()} aria-disabled={isFetching}>
              {isFetching ? 'Tentando…' : 'Tentar de novo'}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
