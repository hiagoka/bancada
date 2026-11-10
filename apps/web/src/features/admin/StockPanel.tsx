import type { StockMovement } from '@bancada/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRef, useState, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '../../components/Button';
import { formatDateTime } from '../../lib/format';
import { shortId } from '../../lib/shortId';
import { FormAlert } from './FormAlert';
import {
  MOVEMENT_REASON_LABEL,
  describeStockError,
  formatDelta,
  stockFormSchema,
  type StockFormInput,
  type StockFormValues,
} from './stockForm';
import { useAdjustStock } from './useProductMutations';
import './admin-products.css';

interface Props {
  productId: string;
  stock: number;
  // Últimas movimentações (GET /admin/products/:id), mais recentes primeiro.
  movements: StockMovement[];
}

// Painel "Estoque" da edição: estoque atual, ajuste com sinal e histórico. Fica FORA do <form> do
// produto (formulário dentro de formulário não existe em HTML).
export function StockPanel({ productId, stock, movements }: Props) {
  const mutation = useAdjustStock(productId);
  const [result, setResult] = useState('');
  const [failure, setFailure] = useState<{ message: string; attempt: number } | null>(null);
  const failureCount = useRef(0);
  const busy = useRef(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<StockFormInput, unknown, StockFormValues>({
    resolver: zodResolver(stockFormSchema),
    defaultValues: { delta: '', reason: 'restock', note: '' },
    shouldFocusError: true,
  });

  const pending = mutation.isPending;

  const submitValid = async (values: StockFormValues): Promise<void> => {
    setFailure(null);
    setResult('');
    try {
      const { movement } = await mutation.mutateAsync(values);
      const before = movement.stockAfter - movement.delta;
      setResult(`Estoque ajustado: ${before} → ${movement.stockAfter}.`);
      reset({ delta: '', reason: values.reason, note: '' });
    } catch (error) {
      failureCount.current += 1;
      setFailure({ message: describeStockError(error, stock), attempt: failureCount.current });
    }
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

  return (
    <section className="stock-panel" aria-labelledby="stock-title">
      <h2 id="stock-title">Estoque</h2>

      <div className="stock-panel__current">
        <span className="admin-form__label">Estoque atual</span>
        <p className="mono stock-panel__value">{stock}</p>
      </div>

      {failure ? <FormAlert message={failure.message} attempt={failure.attempt} /> : null}

      <form className="admin-form" onSubmit={(event) => void onSubmit(event)} noValidate>
        <div className="admin-form__row">
          <div className="field">
            <label htmlFor="stock-delta">Quantidade (+ entra, − sai)</label>
            <input
              id="stock-delta"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              aria-invalid={errors.delta ? true : undefined}
              aria-describedby={['stock-delta-hint', errors.delta ? 'stock-delta-error' : null]
                .filter(Boolean)
                .join(' ')}
              {...register('delta')}
            />
            <p id="stock-delta-hint" className="muted admin-form__hint">
              Inteiro com sinal, por exemplo 10 ou -3.
            </p>
            {errors.delta ? (
              <p id="stock-delta-error" role="alert" className="field-error">
                {errors.delta.message}
              </p>
            ) : null}
          </div>

          <div className="field">
            <label htmlFor="stock-reason">Motivo</label>
            <select id="stock-reason" {...register('reason')}>
              <option value="restock">Reposição</option>
              <option value="adjustment">Ajuste</option>
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="stock-note">Observação (opcional)</label>
          <textarea
            id="stock-note"
            aria-invalid={errors.note ? true : undefined}
            aria-describedby={errors.note ? 'stock-note-error' : undefined}
            {...register('note')}
          />
          {errors.note ? (
            <p id="stock-note-error" role="alert" className="field-error">
              {errors.note.message}
            </p>
          ) : null}
        </div>

        <div className="admin-form__actions">
          <Button type="submit" aria-disabled={pending}>
            {pending ? 'Ajustando…' : 'Ajustar estoque'}
          </Button>
        </div>
        <p role="status" className="admin-notice-inline">
          {result}
        </p>
      </form>

      <h3>Últimas movimentações</h3>
      {movements.length === 0 ? (
        <p>Nenhuma movimentação registrada.</p>
      ) : (
        <table className="admin-table" aria-label="Últimas movimentações do estoque">
          <thead>
            <tr>
              <th scope="col">Data</th>
              <th scope="col">Motivo</th>
              <th scope="col" className="num">
                Variação
              </th>
              <th scope="col" className="num">
                Estoque após
              </th>
              <th scope="col">Observação</th>
              <th scope="col">Pedido</th>
            </tr>
          </thead>
          <tbody>
            {movements.map((movement) => (
              <tr key={movement.id}>
                <td data-label="Data" className="mono">
                  {formatDateTime(movement.createdAt)}
                </td>
                <td data-label="Motivo">{MOVEMENT_REASON_LABEL[movement.reason]}</td>
                <td data-label="Variação" className="num mono">
                  {formatDelta(movement.delta)}
                </td>
                <td data-label="Estoque após" className="num mono">
                  {movement.stockAfter}
                </td>
                <td data-label="Observação">{movement.note ?? '—'}</td>
                <td data-label="Pedido" className="mono">
                  {movement.orderId ? `#${shortId(movement.orderId)}` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
