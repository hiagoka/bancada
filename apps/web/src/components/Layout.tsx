import { useRef, type MouseEvent } from 'react';
import { Link, Outlet } from 'react-router';
import { useFocusMainOnNavigation } from '../lib/useFocusMainOnNavigation';
import { selectTotalItems, useCartStore } from '../features/cart/cartStore';
import { AppLink } from './AppLink';
import { Footer } from './Footer';
import { LiveRegion } from './LiveRegion';
import { Noise } from './Noise';
import './layout.css';

export const itemsLabel = (count: number): string =>
  `${count} ${count === 1 ? 'item' : 'itens'} no carrinho`;

// O skip-link move o foco para o <main> sem depender do hash da URL (que o roteador reescreve).
export function focusMain(event: MouseEvent<HTMLAnchorElement>): void {
  event.preventDefault();
  const main = document.getElementById('conteudo');
  main?.focus();
  main?.scrollIntoView();
}

export function Layout() {
  const mainRef = useRef<HTMLElement>(null);
  useFocusMainOnNavigation(mainRef);
  const cartCount = useCartStore(selectTotalItems);
  return (
    <div className="app">
      <a className="skip-link" href="#conteudo" onClick={focusMain}>
        Pular para o conteúdo
      </a>
      <header className="site-header on-mat">
        <nav className="container site-nav" aria-label="Principal">
          <Link to="/" className="brand">
            Bancada
          </Link>
          <ul className="nav-links">
            <li>
              <AppLink to="/" end>
                Catálogo
              </AppLink>
            </li>
            <li>
              <AppLink to="/carrinho">
                Carrinho
                <span className="cart-count">
                  <span aria-hidden="true">{cartCount}</span>
                  <span className="visually-hidden">{itemsLabel(cartCount)}</span>
                </span>
              </AppLink>
            </li>
          </ul>
        </nav>
      </header>
      <main id="conteudo" tabIndex={-1} ref={mainRef}>
        <Outlet />
      </main>
      <Footer />
      <LiveRegion />
      <Noise />
    </div>
  );
}
