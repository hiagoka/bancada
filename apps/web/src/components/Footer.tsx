import { AppLink } from './AppLink';

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <section aria-labelledby="footer-brand">
          <h2 id="footer-brand">Bancada</h2>
          <p>Equipamentos para a mesa de trabalho de quem programa.</p>
        </section>
        <nav aria-labelledby="footer-shop">
          <h2 id="footer-shop">Loja</h2>
          <ul>
            <li>
              <AppLink to="/" end>
                Catálogo
              </AppLink>
            </li>
            <li>
              <AppLink to="/carrinho">Carrinho</AppLink>
            </li>
          </ul>
        </nav>
        <section aria-labelledby="footer-pay">
          <h2 id="footer-pay">Pagamento</h2>
          <p>Só Pix, pela AbacatePay. No modo de demonstração, o pagamento é simulado.</p>
        </section>
        <section aria-labelledby="footer-about">
          <h2 id="footer-about">Sobre</h2>
          <p>
            Projeto de portfólio. Nenhuma compra aqui é real e nenhum dado é enviado a terceiros.
          </p>
        </section>
      </div>

      <div className="on-mat footer-pay">
        <div className="container">
          <h2>Como pagar</h2>
          <p>
            Você paga por Pix: abra o app do seu banco, leia o QR Code (ou cole o código copia e
            cola) e a página do pedido confirma o pagamento sozinha. No modo simulado, uma tela de
            demonstração permite aprovar, recusar ou cancelar o pagamento.
          </p>
        </div>
      </div>

      <div className="footer-ghost" aria-hidden="true">
        Bancada
      </div>
    </footer>
  );
}
