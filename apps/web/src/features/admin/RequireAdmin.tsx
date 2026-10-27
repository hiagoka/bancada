import { Navigate, Outlet, useLocation } from 'react-router';
import { Button } from '../../components/Button';
import { useNoIndex } from '../../lib/useNoIndex';
import { loginUrl } from './nextPath';
import { useMe } from './useMe';
import './admin.css';

// Guarda das rotas /admin/*. Carregando: estado neutro (sem piscar o login). Sem sessão: login com
// a página pedida em `next`. Falha de rede NÃO é "deslogado": mostra o erro, sem redirecionar.
export function RequireAdmin() {
  const { data, isPending, isError, isFetching, refetch } = useMe();
  const location = useLocation();
  useNoIndex();

  if (isPending) {
    return (
      <div className="container page admin-gate">
        <p role="status">Verificando acesso…</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="container page admin-gate">
        <h1 className="page-title">Admin</h1>
        <div role="alert" className="login-alert">
          <p>
            <strong>A API está fora do ar.</strong> Verifique sua conexão e tente de novo.
          </p>
        </div>
        <Button onClick={() => void refetch()} aria-disabled={isFetching}>
          {isFetching ? 'Tentando…' : 'Tentar de novo'}
        </Button>
      </div>
    );
  }

  if (data === null || data === undefined) {
    return <Navigate to={loginUrl(location.pathname, location.search)} replace />;
  }

  return <Outlet />;
}
