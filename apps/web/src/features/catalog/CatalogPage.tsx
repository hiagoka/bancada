import { NetworkError } from '../../api/http';
import { Button } from '../../components/Button';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { CategorySection } from './CategorySection';
import { Hero } from './Hero';
import { Manifesto } from './Manifesto';
import { groupByCategory } from './groupByCategory';
import { useProducts } from './useProducts';
import './catalog.css';

function CatalogSkeleton() {
  return (
    <div className="container catalog-skeleton" aria-hidden="true">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="catalog-skeleton__card" />
      ))}
    </div>
  );
}

export function CatalogPage() {
  useDocumentTitle('Bancada');
  const { data, isPending, isError, error, refetch, isFetching } = useProducts();
  const groups = data ? groupByCategory(data) : [];

  return (
    <>
      <Hero categories={groups.map((g) => g.category)} />
      <Manifesto />
      <div id="catalogo" tabIndex={-1} className="catalog">
        <p className="visually-hidden" role="status">
          {isPending ? 'Carregando produtos…' : ''}
        </p>
        {isPending ? <CatalogSkeleton /> : null}

        {isError ? (
          <div className="container catalog-message" role="alert">
            <h2>
              {error instanceof NetworkError
                ? 'A API está fora do ar'
                : 'Não foi possível carregar o catálogo'}
            </h2>
            <p>
              {error instanceof NetworkError
                ? 'Não conseguimos falar com o servidor. Verifique sua conexão e tente de novo.'
                : 'Algo deu errado do nosso lado. Tente de novo em instantes.'}
            </p>
            <Button onClick={() => void refetch()} disabled={isFetching}>
              {isFetching ? 'Tentando…' : 'Tentar de novo'}
            </Button>
          </div>
        ) : null}

        {data && data.length === 0 ? (
          <div className="container catalog-message">
            <h2>Nenhum produto por aqui</h2>
            <p>O catálogo está vazio no momento. Volte em breve.</p>
          </div>
        ) : null}

        {groups.map((group, index) => (
          <CategorySection key={group.category} group={group} index={index} />
        ))}
      </div>
    </>
  );
}
