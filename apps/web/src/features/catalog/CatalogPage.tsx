import { ButtonLink } from '../../components/Button';
import { useDocumentTitle } from '../../lib/useDocumentTitle';

// Provisória (T14 traz hero, manifesto e grade de produtos). O título gigante prova a tipografia
// (16vw no celular, 13.5vw no desktop) e o recuo da segunda linha (20vw). Medido com a fonte real:
// "BANCADA" (4,5 em) e "NO AR." (3,0 em) cabem em 360px com o recuo; "ORGANIZADA." (6,2 em)
// NÃO cabe nem sem recuo a 16vw: o hero da T14 precisa de outro tamanho ou de outra quebra.
export function CatalogPage() {
  useDocumentTitle('Bancada');
  return (
    <div className="container hero-test">
      <h1 className="display">
        Bancada
        <span>no ar.</span>
      </h1>
      <p className="page-meta">Catálogo · tarefa T14</p>
      <p className="page-note" style={{ marginTop: 'var(--space-6)' }}>
        O catálogo, o hero e a grade de produtos entram na tarefa T14.
      </p>
      <div style={{ marginTop: 'var(--space-6)' }}>
        <ButtonLink to="/carrinho">Ver carrinho</ButtonLink>
      </div>
    </div>
  );
}
