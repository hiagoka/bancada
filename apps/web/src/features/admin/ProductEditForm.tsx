import type { AdminProductDetail } from '@bancada/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRef, useState, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { Button, ButtonLink } from '../../components/Button';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { FormAlert } from './FormAlert';
import { ImageUpload, type ImageUploadState } from './ImageUpload';
import {
  buildUpdatePatch,
  centsToReais,
  editFormSchema,
  type EditFormInput,
  type EditFormValues,
} from './productForm';
import { describeSaveError } from './productSaveError';
import { useUpdateProduct } from './useProductMutations';
import './admin-products.css';

export function ProductEditForm({ product }: { product: AdminProductDetail }) {
  useDocumentTitle('Editar produto');
  const navigate = useNavigate();
  const mutation = useUpdateProduct(product.id);
  const [image, setImage] = useState<ImageUploadState>({
    change: { kind: 'keep' },
    uploading: false,
  });
  const [failure, setFailure] = useState<{ message: string; attempt: number } | null>(null);
  const [unchanged, setUnchanged] = useState(false);
  const failureCount = useRef(0);
  const busy = useRef(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<EditFormInput, unknown, EditFormValues>({
    resolver: zodResolver(editFormSchema),
    defaultValues: {
      name: product.name,
      description: product.description,
      category: product.category,
      price: centsToReais(product.priceCents),
      active: product.active,
    },
    shouldFocusError: true,
  });

  const pending = mutation.isPending;
  const blocked = pending || image.uploading;

  const submitValid = async (values: EditFormValues): Promise<void> => {
    setFailure(null);
    setUnchanged(false);
    const patch = buildUpdatePatch(product, values, image.change);
    if (!patch) {
      setUnchanged(true); // a API recusa PATCH vazio: nem tenta
      return;
    }
    try {
      await mutation.mutateAsync(patch);
    } catch (error) {
      failureCount.current += 1;
      setFailure({ message: describeSaveError(error), attempt: failureCount.current });
      return;
    }
    navigate('/admin/produtos', {
      state: { notice: `Produto “${values.name}” atualizado.` },
    });
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (busy.current || image.uploading) return;
    busy.current = true;
    try {
      await handleSubmit(submitValid)();
    } finally {
      busy.current = false;
    }
  };

  const describe = (name: keyof EditFormInput): string | undefined =>
    errors[name] ? `product-${name}-error` : undefined;

  return (
    <div className="container page admin-products">
      <h1 className="page-title">Editar produto</h1>

      {failure ? <FormAlert message={failure.message} attempt={failure.attempt} /> : null}

      <form className="admin-form" onSubmit={(event) => void onSubmit(event)} noValidate>
        <div className="field">
          <label htmlFor="product-name">Nome</label>
          <input
            id="product-name"
            type="text"
            autoComplete="off"
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={describe('name')}
            {...register('name')}
          />
          {errors.name ? (
            <p id="product-name-error" role="alert" className="field-error">
              {errors.name.message}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="product-slug">Slug (não pode ser alterado)</label>
          <input id="product-slug" type="text" value={product.slug} readOnly className="mono" />
        </div>

        <div className="field">
          <label htmlFor="product-description">Descrição</label>
          <textarea
            id="product-description"
            aria-invalid={errors.description ? true : undefined}
            aria-describedby={describe('description')}
            {...register('description')}
          />
          {errors.description ? (
            <p id="product-description-error" role="alert" className="field-error">
              {errors.description.message}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="product-category">Categoria</label>
          <input
            id="product-category"
            type="text"
            autoComplete="off"
            aria-invalid={errors.category ? true : undefined}
            aria-describedby={describe('category')}
            {...register('category')}
          />
          {errors.category ? (
            <p id="product-category-error" role="alert" className="field-error">
              {errors.category.message}
            </p>
          ) : null}
        </div>

        <div className="admin-form__row">
          <div className="field">
            <label htmlFor="product-price">Preço (R$)</label>
            <input
              id="product-price"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              aria-invalid={errors.price ? true : undefined}
              aria-describedby={['product-price-hint', describe('price')].filter(Boolean).join(' ')}
              {...register('price')}
            />
            <p id="product-price-hint" className="muted admin-form__hint">
              Em reais, por exemplo 349,90.
            </p>
            {errors.price ? (
              <p id="product-price-error" role="alert" className="field-error">
                {errors.price.message}
              </p>
            ) : null}
          </div>

          <div className="field">
            <span className="admin-form__label">Estoque atual</span>
            <p className="mono admin-form__value">{product.stock}</p>
          </div>
        </div>

        <div className="admin-form__check">
          <input id="product-active" type="checkbox" {...register('active')} />
          <label htmlFor="product-active">Produto ativo (aparece na loja)</label>
        </div>

        <ImageUpload currentUrl={product.imageUrl} onChange={setImage} />

        <div className="admin-form__actions">
          <Button type="submit" aria-disabled={blocked}>
            {pending ? 'Salvando…' : 'Salvar alterações'}
          </Button>
          <ButtonLink variant="secondary" to="/admin/produtos">
            Cancelar
          </ButtonLink>
        </div>
        {image.uploading ? (
          <p className="muted admin-form__hint">Aguarde o envio da imagem para salvar.</p>
        ) : null}
        <p role="status" className="admin-form__hint">
          {unchanged ? 'Nenhuma alteração para salvar.' : ''}
        </p>
      </form>
    </div>
  );
}
