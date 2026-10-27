import { useRef, type MouseEvent } from 'react';
import { Link, Outlet } from 'react-router';
import { useFocusMainOnNavigation } from '../lib/useFocusMainOnNavigation';
import { AppLink } from './AppLink';
import { Footer } from './Footer';
import { Noise } from './Noise';
import './layout.css';

// Até a T14 (carrinho de verdade), o contador é um valor fixo.
const CART_COUNT_PLACEHOLDER = 0;

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
                  <span aria-hidden="true">{CART_COUNT_PLACEHOLDER}</span>
                  <span className="visually-hidden">{itemsLabel(CART_COUNT_PLACEHOLDER)}</span>
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
      <Noise />
    </div>
  );
}
