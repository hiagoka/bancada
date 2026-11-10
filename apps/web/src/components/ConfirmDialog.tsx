import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import './dialog.css';

interface Props {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  // Enviando: botões aria-disabled, confirmar não repete e Esc/fundo não fecham.
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const FOCUSABLE =
  'button:not([aria-disabled="true"]):not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Diálogo de confirmação (sem window.confirm): role="dialog" aria-modal, foco preso (Tab/Shift+Tab),
// Esc e clique no fundo fecham, o resto da página fica inerte e o foco volta a quem abriu.
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Tudo que está no <body> fora do diálogo fica inerte (teclado, clique e leitor de tela).
    const inerted: HTMLElement[] = [];
    for (const child of Array.from(document.body.children)) {
      const isDialog = child === backdropRef.current;
      if (child instanceof HTMLElement && !isDialog && !child.hasAttribute('inert')) {
        child.setAttribute('inert', '');
        inerted.push(child);
      }
    }
    cancelRef.current?.focus(); // o botão seguro (não destrutivo) recebe o foco
    return () => {
      for (const element of inerted) element.removeAttribute('inert');
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);

  if (!open) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (!busy) onCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    const first = items[0];
    const last = items.at(-1);
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      ref={backdropRef}
      className="dialog-backdrop"
      onKeyDown={onKeyDown}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div
        ref={panelRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <h2 id={titleId} className="dialog__title">
          {title}
        </h2>
        <p id={descriptionId}>{description}</p>
        <div className="dialog__actions">
          <Button
            ref={cancelRef}
            variant="secondary"
            aria-disabled={busy}
            onClick={() => !busy && onCancel()}
          >
            {cancelLabel}
          </Button>
          <Button aria-disabled={busy} onClick={() => !busy && onConfirm()}>
            {busy ? 'Cancelando…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
