import { createOrderInputSchema, type PublicOrder } from '@bancada/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import type { z } from 'zod';
import { Button } from '../../components/Button';
import { useAnnouncer } from '../../lib/announcer';
import { formatPrice } from '../../lib/format';
import { selectSubtotalCents, useCartStore } from '../cart/cartStore';
import { PRODUCTS_QUERY_KEY } from '../catalog/useProducts';
import { CheckoutAlert } from './CheckoutAlert';
import { describeCheckoutError, type CheckoutFailure } from './checkoutErrors';
import { orderSignature } from './orderSignature';
import { resolveRedirect } from './redirect';
import { useCreateOrder } from './useCreateOrder';
import { useIdempotencyKey } from './useIdempotencyKey';
import './checkout.css';

// A MESMA definição de customer da API (mensagens já em PT-BR): nada de schema paralelo.
const customerSchema = createOrderInputSchema.shape.customer;
type CustomerInput = z.input<typeof customerSchema>;
type Customer = z.output<typeof customerSchema>;

const defaultRedirectExternal = (url: string): void => window.location.assign(url);

interface Props {
  // Redirecionamento para fora do site (provedor com checkout externo). Injetável para testar sem navegar de verdade.
  redirectExternal?: (url: string) => void;
  // Relógio injetável (testes): idade máxima da chave salva.
  now?: () => number;
}

export function CheckoutForm({ redirectExternal = defaultRedirectExternal, now }: Props) {
  const lines = useCartStore((state) => state.lines);
  const total = useCartStore(selectSubtotalCents);
  const clear = useCartStore((state) => state.clear);
  const setQuantity = useCartStore((state) => state.setQuantity);
  const remove = useCartStore((state) => state.remove);
  const announce = useAnnouncer((state) => state.announce);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const mutation = useCreateOrder();
  const idempotency = useIdempotencyKey(now);

  const [failure, setFailure] = useState<{ value: CheckoutFailure; attempt: number } | null>(null);
  // Guarda contra duplo clique: o `disabled` só vale depois do re-render, esta ref é imediata.
  const busy = useRef(false);
  // Contador que só cresce (independe de o alerta ter sido limpo e recriado no mesmo ciclo).
  const failureCount = useRef(0);
  const payButtonRef = useRef<HTMLButtonElement>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CustomerInput, unknown, Customer>({
    resolver: zodResolver(customerSchema),
    defaultValues: { name: '', email: '' },
    shouldFocusError: true, // foco no primeiro campo inválido
  });

  const pending = mutation.isPending;

  const redirectAfterSuccess = (order: PublicOrder): void => {
    const target = resolveRedirect(order.checkoutUrl, order.id, window.location.origin);
    if (target.kind === 'internal') {
      // Troca o "Criando seu pedido…" por um aviso que faz sentido na página de destino.
      announce(
        target.to.startsWith('/checkout-simulado')
          ? 'Pedido criado. Siga para o pagamento simulado.'
          : order.pix
            ? 'Pedido criado. Abra o Pix para pagar.'
            : 'Pedido criado.',
      );
      navigate(target.to);
    } else {
      redirectExternal(target.url);
    }
  };

  const submitValid = async (customer: Customer): Promise<void> => {
    setFailure(null);
    const current = useCartStore.getState().lines; // o carrinho de AGORA, não o do último render
    if (current.length === 0) return;
    const expectedTotal = current.reduce((sum, l) => sum + l.product.priceCents * l.quantity, 0);
    announce('Criando seu pedido…');

    const signature = orderSignature(current, customer);
    let order: PublicOrder;
    try {
      // Dentro do try: se algo falhar antes do envio (ex.: gerar a chave), aparece como erro na tela.
      const key = idempotency.keyFor(signature);
      order = await mutation.mutateAsync({
        input: {
          customer,
          items: current.map((line) => ({ productId: line.product.id, quantity: line.quantity })),
        },
        idempotencyKey: key,
      });
    } catch (error) {
      const described = describeCheckoutError(error, current);
      // Chave nova quando o servidor diz que a anterior não serve mais.
      if (
        described.kind === 'reused' ||
        (described.kind === 'checkout_unavailable' && described.expired)
      ) {
        try {
          idempotency.rotate(signature); // gera e grava a nova chave
        } catch {
          idempotency.renew(); // sem como gerar agora: a próxima tentativa tenta de novo
        }
      }
      failureCount.current += 1;
      setFailure({ value: described, attempt: failureCount.current });
      return;
    }

    // Pedido que NÃO está PENDING (replay de uma chave antiga: o admin cancelou, estornou ou já foi
    // pago): não é um checkout bem-sucedido. Nada de limpar o carrinho nem ir ao pagamento.
    if (order.status !== 'PENDING') {
      idempotency.renew(); // a próxima tentativa usa chave nova
      if (order.status === 'PAID') {
        navigate(`/pedido/${order.id}`); // a página do pedido mostra o pagamento
        return;
      }
      failureCount.current += 1;
      setFailure({ value: { kind: 'closed' }, attempt: failureCount.current });
      return;
    }

    // Pedido criado: os efeitos abaixo ficam FORA do try. Se o redirecionamento lançar, não é
    // "erro ao criar o pedido" (ele existe e o carrinho já foi limpo).
    idempotency.renew(); // a próxima compra (mesmos itens) é OUTRO pedido
    clear();
    if (order.totalCents !== expectedTotal) {
      // O servidor cobra o preço do banco: se difere do que a tela mostrou, não leva a pessoa a
      // pagar um valor que ela não viu. Abre o pedido, que mostra o total real.
      announce(
        `O total do pedido mudou para ${formatPrice(order.totalCents)}. Confira antes de pagar.`,
      );
      navigate(`/pedido/${order.id}`);
      return;
    }
    redirectAfterSuccess(order);
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    try {
      await handleSubmit(submitValid)();
    } finally {
      busy.current = false;
    }
  };

  const adjustStock = (): void => {
    if (failure?.value.kind !== 'out_of_stock') return;
    // available 0 remove a linha; os dados do cliente ficam como estão. O carrinho muda, então a
    // assinatura muda e a próxima tentativa usa chave nova sozinha.
    for (const item of failure.value.items) setQuantity(item.productId, item.available);
    void queryClient.invalidateQueries({ queryKey: PRODUCTS_QUERY_KEY });
    announce('Carrinho ajustado ao estoque disponível.');
    setFailure(null);
    payButtonRef.current?.focus(); // o botão clicado some: o foco não pode ir para o body
  };

  const removeUnavailable = (): void => {
    if (failure?.value.kind !== 'unavailable') return;
    for (const item of failure.value.items) remove(item.productId);
    void queryClient.invalidateQueries({ queryKey: PRODUCTS_QUERY_KEY }); // sincroniza com o catálogo
    announce('Itens indisponíveis removidos do carrinho.');
    setFailure(null);
    payButtonRef.current?.focus();
  };

  const refreshStock = (): void => {
    void queryClient.invalidateQueries({ queryKey: PRODUCTS_QUERY_KEY });
    setFailure(null);
    payButtonRef.current?.focus();
  };

  return (
    <section className="checkout" aria-labelledby="checkout-title" data-testid="checkout-slot">
      <h2 id="checkout-title">Finalizar compra</h2>

      <div className="checkout-summary">
        <h3 className="visually-hidden">Resumo do pedido</h3>
        <ul>
          {lines.map((line) => (
            <li key={line.product.id}>
              <span>
                {line.product.name} <span className="mono">× {line.quantity}</span>
              </span>
              <span className="price">{formatPrice(line.product.priceCents * line.quantity)}</span>
            </li>
          ))}
        </ul>
        <p className="checkout-summary__total">
          <span>Total</span>
          <span className="price">{formatPrice(total)}</span>
        </p>
      </div>

      {failure ? (
        <CheckoutAlert
          failure={failure.value}
          attempt={failure.attempt}
          onAdjustStock={adjustStock}
          onRemoveUnavailable={removeUnavailable}
          onRefreshStock={refreshStock}
        />
      ) : null}

      <form className="checkout-form" onSubmit={(event) => void onSubmit(event)} noValidate>
        <div className="field">
          <label htmlFor="checkout-name">Nome</label>
          <input
            id="checkout-name"
            type="text"
            autoComplete="name"
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? 'checkout-name-error' : undefined}
            {...register('name')}
          />
          {errors.name ? (
            <p id="checkout-name-error" role="alert" className="field-error">
              {errors.name.message}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="checkout-email">E-mail</label>
          <input
            id="checkout-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? 'checkout-email-error' : undefined}
            {...register('email')}
          />
          {errors.email ? (
            <p id="checkout-email-error" role="alert" className="field-error">
              {errors.email.message}
            </p>
          ) : null}
        </div>

        <Button
          ref={payButtonRef}
          type="submit"
          aria-disabled={pending}
          className="checkout-submit"
        >
          {pending ? 'Abrindo o pagamento…' : `Pagar ${formatPrice(total)}`}
        </Button>
        <p className="muted checkout-note">Você vai pagar por Pix.</p>
      </form>
    </section>
  );
}
