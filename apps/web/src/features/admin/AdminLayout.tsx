import { useRef } from 'react';
import { Link, Outlet } from 'react-router';
import { AppLink } from '../../components/AppLink';
import { Button } from '../../components/Button';
import { Noise } from '../../components/Noise';
import { focusMain } from '../../components/Layout';
import { useFocusMainOnNavigation } from '../../lib/useFocusMainOnNavigation';
import '../../components/layout.css';

// Casca do admin: mesmos tokens e fontes, sem hero, ruído a 0.04 e densidade maior.
// "Sair" ainda não tem lógica (T17).
export function AdminLayout() {
  const mainRef = useRef<HTMLElement>(null);
  useFocusMainOnNavigation(mainRef);
  return (
    <div className="app admin">
      <a className="skip-link" href="#conteudo" onClick={focusMain}>
        Pular para o conteúdo
      </a>
      <header className="site-header on-mat">
        <nav className="container site-nav" aria-label="Administração">
          <Link to="/admin/produtos" className="brand">
            Bancada <span className="admin-badge">· Admin</span>
          </Link>
          <div className="admin-nav-actions">
            <ul className="nav-links">
              <li>
                <AppLink to="/admin/produtos">Produtos</AppLink>
              </li>
              <li>
                <AppLink to="/admin/pedidos">Pedidos</AppLink>
              </li>
            </ul>
            <Button variant="secondary">Sair</Button>
          </div>
        </nav>
      </header>
      <main id="conteudo" tabIndex={-1} ref={mainRef}>
        <Outlet />
      </main>
      <Noise />
    </div>
  );
}
