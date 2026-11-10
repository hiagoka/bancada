import type { PixCharge } from '@bancada/contracts';
import { useEffect, useRef, useState } from 'react';
import { Button, ButtonLink } from '../../components/Button';
import { copyText } from '../../lib/clipboard';
import { shortId } from '../../lib/shortId';
import { usePixCountdown } from './usePixCountdown';
import './pix.css';

// A API só entrega o QR Code como PNG embutido. O web confere de novo antes de pôr num <img src>:
// qualquer outra coisa (URL externa, outro tipo) não é renderizada.
const PNG_DATA_URI = 'data:image/png;base64,';
const COPIED_MESSAGE_MS = 4000;

interface Props {
  orderId: string;
  pix: PixCharge;
  // Chamada UMA vez quando a contagem zera: a última consulta ao pedido (ele pode ter sido pago no
  // último segundo). Só depois dela a tela diz que o tempo acabou.
  onExpired: () => Promise<unknown> | void;
}

// Pagamento por Pix na página do pedido (D34): QR Code, copia e cola e contagem regressiva.
export function PixPayment({ orderId, pix, onExpired }: Props) {
  const { display, expired, announcement } = usePixCountdown(pix.expiresAt);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [checked, setChecked] = useState(false);
  const fieldRef = useRef<HTMLInputElement>(null);
  const asked = useRef(false);
  const onExpiredRef = useRef(onExpired);
  onExpiredRef.current = onExpired;

  useEffect(() => {
    if (!expired || asked.current) return;
    asked.current = true;
    void (async () => {
      try {
        await onExpiredRef.current();
      } catch {
        // Falha de rede na última consulta: o tempo acabou do mesmo jeito.
      } finally {
        setChecked(true);
      }
    })();
  }, [expired]);

  useEffect(() => {
    if (copyState !== 'copied') return;
    const timer = setTimeout(() => setCopyState('idle'), COPIED_MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [copyState]);

  const copy = async (): Promise<void> => {
    let copied: boolean;
    try {
      copied = await copyText(pix.brCode);
    } catch {
      copied = false;
    }
    if (copied) {
      setCopyState('copied');
      return;
    }
    // Sem como copiar sozinho: deixa o código selecionado para a pessoa copiar à mão.
    setCopyState('failed');
    fieldRef.current?.focus();
    fieldRef.current?.select();
  };

  if (expired && checked) {
    return (
      <div className="order-panel">
        <p>
          <strong>O tempo para pagar acabou.</strong>
        </p>
        <p>Este Pix não vale mais e este pedido não será cobrado. Faça um novo pedido.</p>
        <div className="pix__actions">
          <ButtonLink to="/">Voltar ao catálogo</ButtonLink>
          <ButtonLink variant="secondary" to="/carrinho">
            Ir para o carrinho
          </ButtonLink>
        </div>
      </div>
    );
  }

  const showQr = pix.qrCodeImage.startsWith(PNG_DATA_URI);

  return (
    <section className="order-panel pix" aria-labelledby="pix-title">
      <h2 id="pix-title" className="pix__title">
        Pague com Pix
      </h2>

      <ol className="pix__steps" aria-label="Como pagar com Pix">
        <li>Abra o app do seu banco e escolha pagar com Pix.</li>
        <li>Leia o QR Code abaixo ou cole o código copia e cola.</li>
        <li>Pronto: esta página confirma o pagamento sozinha.</li>
      </ol>

      <div className="pix__body">
        {showQr ? (
          <div className="pix__qr">
            <img
              src={pix.qrCodeImage}
              width={240}
              height={240}
              alt={`QR Code do Pix para pagar o pedido #${shortId(orderId)}`}
            />
          </div>
        ) : (
          <p className="pix__hint">
            Não foi possível mostrar o QR Code. Use o código copia e cola.
          </p>
        )}

        <div className="pix__copy">
          <label htmlFor="pix-code" className="pix__label">
            Pix copia e cola
          </label>
          <input
            ref={fieldRef}
            id="pix-code"
            className="mono pix__code"
            type="text"
            readOnly
            value={pix.brCode}
            onFocus={(event) => event.currentTarget.select()}
            spellCheck={false}
            autoComplete="off"
          />
          <Button onClick={() => void copy()}>Copiar código</Button>
          <p role="status" aria-live="polite" className="pix__feedback">
            {copyState === 'copied' ? 'Código copiado.' : null}
            {copyState === 'failed'
              ? 'Não foi possível copiar automaticamente. O código está selecionado: copie manualmente.'
              : null}
          </p>
        </div>
      </div>

      <p className="pix__countdown">
        Este Pix vale por{' '}
        <time className="mono pix__time" dateTime={pix.expiresAt}>
          {display}
        </time>
      </p>
      {/* Só marcos (a cada minuto, 10 s finais, fim): o número acima NÃO é uma região aria-live. */}
      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
      {expired && !checked ? (
        <p role="status" className="pix__hint">
          Conferindo se o pagamento chegou…
        </p>
      ) : null}
    </section>
  );
}
