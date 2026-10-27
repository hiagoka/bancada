import { ButtonLink } from '../components/Button';
import { useDocumentTitle } from '../lib/useDocumentTitle';

export function NotFoundPage() {
  useDocumentTitle('Página não encontrada');
  return (
    <div className="container page">
      <p className="page-meta">Erro 404</p>
      <h1 className="page-title">Página não encontrada</h1>
      <p className="page-note">O endereço que você abriu não existe ou foi movido.</p>
      <div style={{ marginTop: 'var(--space-6)' }}>
        <ButtonLink to="/">Voltar ao catálogo</ButtonLink>
      </div>
    </div>
  );
}
