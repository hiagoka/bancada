import type { OrderStatus } from '@bancada/contracts';
import { trackerSteps, type StepState } from './orderStatus';

// Cada estado tem uma FORMA própria (✓ ● ○ ✕) e um TEXTO escrito: nada depende só de cor.
function StepIcon({ state }: { state: StepState }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      <rect x="1.5" y="1.5" width="21" height="21" />
      {state === 'done' ? <path d="M6 12.5l4 4 8-9" /> : null}
      {state === 'current' ? (
        <rect x="8" y="8" width="8" height="8" fill="currentColor" stroke="none" />
      ) : null}
      {state === 'failed' ? <path d="M7 7l10 10M17 7L7 17" /> : null}
    </svg>
  );
}

// Pedido recebido -> Pagamento -> Confirmado.
export function OrderTracker({ status }: { status: OrderStatus }) {
  return (
    <ol className="tracker" aria-label="Andamento do pedido">
      {trackerSteps(status).map((step) => (
        <li
          key={step.label}
          className={`tracker__step tracker__step--${step.state}`}
          aria-current={step.state === 'current' ? 'step' : undefined}
        >
          <span className="tracker__icon" aria-hidden="true">
            <StepIcon state={step.state} />
          </span>
          <span className="tracker__label">{step.label}</span>
          <span className="tracker__state">{step.note ?? step.stateText}</span>
        </li>
      ))}
    </ol>
  );
}
