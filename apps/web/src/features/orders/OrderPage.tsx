import { useParams } from 'react-router';
import { Placeholder } from '../../components/Placeholder';

export function OrderPage() {
  const { id } = useParams();
  return (
    <Placeholder title="Pedido" task="T16">
      <p className="page-meta">Pedido {id}</p>
    </Placeholder>
  );
}
