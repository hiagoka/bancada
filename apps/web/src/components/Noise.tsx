// Textura de grão (D25): tile estático repetido; a opacidade vem de --noise-opacity (0.08 na loja,
// 0.04 no admin). Decorativo: fora da árvore de acessibilidade e sem capturar cliques.
export function Noise() {
  return <div className="noise" aria-hidden="true" />;
}
