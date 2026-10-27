import { useParams } from 'react-router';
import { Placeholder } from '../../components/Placeholder';

// Serve /admin/produtos/novo e /admin/produtos/:id.
export function ProductFormPage() {
  const { id } = useParams();
  return (
    <Placeholder title={id ? 'Editar produto' : 'Novo produto'} task={id ? 'T18/T19' : 'T18'}>
      {id ? <p className="page-meta">Produto {id}</p> : null}
    </Placeholder>
  );
}
