import { useParams } from 'react-router';
import { Placeholder } from '../../components/Placeholder';
import { ProductCreateForm } from './ProductCreateForm';

// Serve /admin/produtos/novo e /admin/produtos/:id.
export function ProductFormPage() {
  const { id } = useParams();
  if (!id) return <ProductCreateForm />;
  return (
    <Placeholder title="Editar produto" task="T18">
      <p className="page-meta">Produto {id}</p>
    </Placeholder>
  );
}
