import { zodResolver } from '@hookform/resolvers/zod';
import { useRef, useState, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { Button, ButtonLink } from '../../components/Button';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { FormAlert } from './FormAlert';
import { ImageUpload, type ImageUploadState } from './ImageUpload';
import {
  createFormSchema,
  toCreateInput,
  type CreateFormInput,
  type CreateFormValues,
} from './productForm';
import { describeSaveError } from './productSaveError';
import { useCreateProduct } from './useProductMutations';
import './admin-products.css';

export function ProductCreateForm() {
  useDocumentTitle('Novo produto');
  const navigate = useNavigate();
  const mutation = useCreateProduct();
  const [image, setImage] = useState<ImageUploadState>({
    change: { kind: 'keep' },
    uploading: false,
  });
  const [failure, setFailure] = useState<{ message: string; attempt: number } | null>(null);
  const failureCount = useRef(0);
  const busy = useRef(false); // guarda imediata contra duplo clique

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateFormInput, unknown, CreateFormValues>({
    resolver: zodResolver(createFormSchema),
    defaultValues: { name: '', description: '', category: '', price: '', initialStock: '0' },
    shouldFocusError: true,
  });

  const pending = mutation.isPending;
  const blocked = pending || image.uploading;

  const submitValid = async (values: CreateFormValues): Promise<void> => {
    setFailure(null);
    const imageKey = image.change.kind === 'replace' ? image.change.key : null;
    try {
      await mutation.mutateAsync(toCreateInput(values, imageKey));
    } catch (error) {
      failureCount.current += 1;
      setFailure({ message: describeSaveError(error), attempt: failureCount.current });
      return;
    }
    navigate('/admin/produtos', { state: { notice: `Produto “${values.name}” criado.` } });
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

  const describe = (name: keyof CreateFormInput): string | undefined =>
    errors[name] ? `product-${name}-error` : undefined;

  return (
    <div className="container page admin-products">
      <h1 className="page-title">Novo produto</h1>

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
            <label htmlFor="product-stock">Estoque inicial</label>
            <input
              id="product-stock"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              aria-invalid={errors.initialStock ? true : undefined}
              aria-describedby={describe('initialStock')}
              {...register('initialStock')}
            />
            {errors.initialStock ? (
              <p id="product-initialStock-error" role="alert" className="field-error">
                {errors.initialStock.message}
              </p>
            ) : null}
          </div>
        </div>

        <ImageUpload currentUrl={null} onChange={setImage} />

        <div className="admin-form__actions">
          <Button type="submit" aria-disabled={blocked}>
            {pending ? 'Criando…' : 'Criar produto'}
          </Button>
          <ButtonLink variant="secondary" to="/admin/produtos">
            Cancelar
          </ButtonLink>
        </div>
        {image.uploading ? (
          <p className="muted admin-form__hint">Aguarde o envio da imagem para salvar.</p>
        ) : null}
      </form>
    </div>
  );
}
