import { ALLOWED_UPLOAD_CONTENT_TYPES } from '@bancada/contracts';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../../components/Button';
import { UploadError, uploadProductImage, validateImageFile } from './uploadImage';
import type { ImageChange } from './productForm';

export interface ImageUploadState {
  change: ImageChange;
  uploading: boolean;
}

interface Props {
  // Imagem que o produto já tem (edição); null na criação ou sem imagem.
  currentUrl: string | null;
  onChange: (state: ImageUploadState) => void;
  // Injetável nos testes.
  upload?: typeof uploadProductImage;
}

const ACCEPT = ALLOWED_UPLOAD_CONTENT_TYPES.join(',');

// Escolha da imagem do produto: valida (tipo e 2 MB), mostra a prévia, envia direto ao S3/MinIO com
// progresso e informa ao formulário o que fazer com a imageKey (manter, remover, trocar).
export function ImageUpload({ currentUrl, onChange, upload = uploadProductImage }: Props) {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const [removed, setRemoved] = useState(false);
  const [uploaded, setUploaded] = useState<{ key: string; previewUrl: string | null } | null>(null);
  const [pending, setPending] = useState<{ previewUrl: string | null; percent: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
    };
  }, []);

  const report = (change: ImageChange, uploading = false): void => onChange({ change, uploading });

  const makePreview = (file: File): string | null =>
    typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null;
  const dropPreview = (url: string | null): void => {
    if (url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
  };

  const onFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setError(null);
    const problem = validateImageFile(file);
    if (problem) {
      setError(problem);
      if (fileInput.current) fileInput.current.value = '';
      return;
    }
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const previewUrl = makePreview(file);
    setPending({ previewUrl, percent: 0 });
    report(uploaded ? { kind: 'replace', key: uploaded.key } : { kind: 'keep' }, true);
    try {
      const key = await upload(
        file,
        (percent) => alive.current && setPending({ previewUrl, percent }),
        {
          signal: abort.signal,
        },
      );
      if (!alive.current || abort.signal.aborted) return;
      dropPreview(uploaded?.previewUrl ?? null);
      setUploaded({ key, previewUrl });
      setPending(null); // `removed` fica: descartar a nova imagem volta ao estado anterior
      report({ kind: 'replace', key });
    } catch (caught) {
      dropPreview(previewUrl);
      // Envio obsoleto (outro arquivo foi escolhido): não mexe no estado do envio atual.
      if (!alive.current || controller.current !== abort) return;
      setPending(null);
      const aborted = caught instanceof DOMException && caught.name === 'AbortError';
      if (!aborted) {
        setError(
          caught instanceof UploadError
            ? caught.message
            : 'Não foi possível enviar a imagem. Tente de novo.',
        );
      }
      report(uploaded ? { kind: 'replace', key: uploaded.key } : { kind: 'keep' });
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const cancel = (): void => controller.current?.abort();

  const discardNew = (): void => {
    dropPreview(uploaded?.previewUrl ?? null);
    setUploaded(null);
    report(removed ? { kind: 'remove' } : { kind: 'keep' });
  };

  const remove = (): void => {
    setRemoved(true);
    report({ kind: 'remove' });
  };
  const undoRemove = (): void => {
    setRemoved(false);
    report({ kind: 'keep' });
  };

  const showCurrent = currentUrl !== null && !removed && uploaded === null && pending === null;
  const shown = pending?.previewUrl ?? uploaded?.previewUrl ?? null;

  return (
    <div className="image-upload">
      <div className="field">
        <label htmlFor={inputId}>Imagem do produto</label>
        <input
          ref={fileInput}
          id={inputId}
          type="file"
          accept={ACCEPT}
          aria-describedby={[error ? errorId : null, `${inputId}-hint`].filter(Boolean).join(' ')}
          aria-invalid={error ? true : undefined}
          onChange={(event) => void onFile(event.target.files?.[0])}
        />
        <p id={`${inputId}-hint`} className="muted image-upload__hint">
          JPEG, PNG ou WebP, até 2 MB. Opcional.
        </p>
        {error ? (
          <p id={errorId} role="alert" className="field-error">
            {error}
          </p>
        ) : null}
      </div>

      {showCurrent ? (
        <figure className="image-upload__preview">
          <img src={currentUrl} alt="Imagem atual do produto" />
        </figure>
      ) : null}
      {shown ? (
        <figure className="image-upload__preview">
          <img src={shown} alt="Pré-visualização da nova imagem" />
        </figure>
      ) : null}

      {pending ? (
        <div className="image-upload__progress">
          <progress
            max={100}
            value={pending.percent}
            role="progressbar"
            aria-label="Envio da imagem"
            aria-valuenow={pending.percent}
            aria-valuemin={0}
            aria-valuemax={100}
          />
          <p role="status">Enviando… {pending.percent}%</p>
          <Button variant="secondary" onClick={cancel}>
            Cancelar envio
          </Button>
        </div>
      ) : null}

      {uploaded && !pending ? (
        <div className="image-upload__actions">
          <p role="status">Imagem enviada. Ela passa a valer quando você salvar.</p>
          <Button variant="secondary" onClick={discardNew}>
            Descartar nova imagem
          </Button>
        </div>
      ) : null}

      {removed && !pending && !uploaded ? (
        <div className="image-upload__actions">
          <p role="status">A imagem será removida quando você salvar.</p>
          <Button variant="secondary" onClick={undoRemove}>
            Desfazer
          </Button>
        </div>
      ) : null}

      {currentUrl !== null && !removed && !pending && !uploaded ? (
        <Button variant="secondary" onClick={remove}>
          Remover imagem
        </Button>
      ) : null}
    </div>
  );
}
