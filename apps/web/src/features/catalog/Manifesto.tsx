// Manifesto (D25): rótulo nas colunas 1-4 sobre uma borda; texto grande nas colunas 5-12, com recuo
// na primeira linha e as frases-chave em --mat.
export function Manifesto() {
  return (
    <section className="manifesto container grid-12" aria-labelledby="manifesto-label">
      <h2
        id="manifesto-label"
        className="manifesto__label col mono"
        style={{ '--col-start': 1, '--col-span': 4 } as React.CSSProperties}
      >
        Manifesto
      </h2>
      <p
        className="manifesto__text col"
        style={{ '--col-start': 5, '--col-span': 8 } as React.CSSProperties}
      >
        A mesa de quem programa é onde o dia inteiro acontece. Por isso o equipamento tem de sumir
        na mão: <strong>teclado que responde</strong> sem pedir licença,{' '}
        <strong>mouse que cabe na mão</strong> depois de oito horas,{' '}
        <strong>cabo que não vira nó</strong> na sexta à noite. Peças escolhidas uma a uma, sem
        enfeite, para você voltar ao código.
      </p>
    </section>
  );
}
