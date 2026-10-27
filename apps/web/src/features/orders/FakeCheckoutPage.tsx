import { useParams } from 'react-router';
import { Placeholder } from '../../components/Placeholder';

export function FakeCheckoutPage() {
  const { id } = useParams();
  return (
    <Placeholder title="Checkout simulado" task="T16">
      <p className="page-meta">Pedido {id}</p>
    </Placeholder>
  );
}
