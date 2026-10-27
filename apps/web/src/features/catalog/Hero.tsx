import type { MouseEvent } from 'react';
import { Button } from '../../components/Button';

function scrollToCatalog(event: MouseEvent<HTMLElement>): void {
  event.preventDefault();
  const target = document.getElementById('catalogo');
  if (!target) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
  target.focus({ preventScroll: true });
}

// Hero (D25): fundo --mat quadriculado, título dividido e recuado, metadados em mono, botão em
// tape e régua de fita métrica na base. É o ÚNICO elemento chamativo da loja.
export function Hero({ categories }: { categories: string[] }) {
  return (
    <section className="hero on-mat" aria-labelledby="hero-title">
      <div className="container hero__inner">
        <div className="hero__content">
          <h1 id="hero-title" className="display hero__title">
            <span className="hero__line">Mesa</span>
            <span className="hero__line hero__line--indent">Organizada.</span>
          </h1>
          <p className="hero__meta mono">
            {categories.length > 0 ? categories.join(' · ') : 'Equipamentos para quem programa'}
          </p>
          <Button onClick={scrollToCatalog}>Ver catálogo</Button>
        </div>
      </div>
      <div className="hero__ruler" aria-hidden="true" />
    </section>
  );
}
