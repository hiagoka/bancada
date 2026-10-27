import { loginInputSchema, type Admin } from '@bancada/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
import type { z } from 'zod';
import { login } from '../../api/auth';
import { Button } from '../../components/Button';
import { useNoIndex } from '../../lib/useNoIndex';
import { describeLoginError } from './loginError';
import { sanitizeNext } from './nextPath';
import { ME_QUERY_KEY, useMe } from './useMe';
import './admin.css';

type LoginFormInput = z.input<typeof loginInputSchema>;
type LoginFormOutput = z.output<typeof loginInputSchema>;

export const LOGIN_TITLE = 'Entrar · Bancada Admin';

export function LoginPage() {
  const [params] = useSearchParams();
  // O destino NUNCA vem cru da URL: só caminho interno do admin passa.
  const next = sanitizeNext(params.get('next'));
  const navigate = useNavigate();
  const location = useLocation();
  const logoutFailed = (location.state as { logoutFailed?: boolean } | null)?.logoutFailed === true;
  const queryClient = useQueryClient();
  const me = useMe();
  useNoIndex();
  useEffect(() => {
    document.title = LOGIN_TITLE;
  }, []);

  const mutation = useMutation<Admin, unknown, LoginFormOutput>({
    mutationKey: ['admin', 'login'],
    mutationFn: (input) => login(input),
    retry: false,
    gcTime: 0, // as variáveis (com a senha) não ficam em memória depois do envio
  });

  const [failure, setFailure] = useState<{ message: string; attempt: number } | null>(null);
  const failureCount = useRef(0);
  const busy = useRef(false); // guarda imediata contra duplo clique
  const alertRef = useRef<HTMLDivElement>(null);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<LoginFormInput, unknown, LoginFormOutput>({
    resolver: zodResolver(loginInputSchema),
    defaultValues: { email: '', password: '' },
    shouldFocusError: true,
  });

  useEffect(() => {
    if (failure) alertRef.current?.focus();
  }, [failure]);

  const submitValid = async (input: LoginFormOutput): Promise<void> => {
    setFailure(null);
    try {
      const admin = await mutation.mutateAsync(input);
      // Outro admin pode ter usado este navegador: nada do cache anterior sobra.
      queryClient.removeQueries({ queryKey: ['admin'], predicate: (q) => q.queryKey[1] !== 'me' });
      queryClient.setQueryData(ME_QUERY_KEY, admin);
      mutation.reset();
      navigate(next, { replace: true });
    } catch (error) {
      setValue('password', ''); // a senha não fica na tela depois de um erro
      failureCount.current += 1;
      setFailure({ message: describeLoginError(error), attempt: failureCount.current });
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

  if (me.data) return <Navigate to={next} replace />;

  if (me.isPending) {
    return (
      <div className="container page login-page">
        <p role="status">Verificando acesso…</p>
      </div>
    );
  }

  const pending = mutation.isPending;

  return (
    <div className="container page login-page">
      <h1 className="page-title">Entrar</h1>

      {logoutFailed ? (
        <p role="status" className="login-alert">
          Não foi possível encerrar a sessão no servidor. Tente sair de novo antes de deixar o
          computador.
        </p>
      ) : null}

      {failure ? (
        <div
          key={failure.attempt}
          ref={alertRef}
          role="alert"
          tabIndex={-1}
          className="login-alert"
          id="login-alert"
        >
          {failure.message}
        </div>
      ) : null}

      <form className="login-form" onSubmit={(event) => void onSubmit(event)} noValidate>
        <div className="field">
          <label htmlFor="login-email">E-mail</label>
          <input
            id="login-email"
            type="email"
            inputMode="email"
            autoComplete="username"
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? 'login-email-error' : undefined}
            {...register('email')}
          />
          {errors.email ? (
            <p id="login-email-error" role="alert" className="field-error">
              {errors.email.message}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="login-password">Senha</label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={errors.password ? 'login-password-error' : undefined}
            {...register('password')}
          />
          {errors.password ? (
            <p id="login-password-error" role="alert" className="field-error">
              {errors.password.message}
            </p>
          ) : null}
        </div>

        <Button type="submit" aria-disabled={pending}>
          {pending ? 'Entrando…' : 'Entrar'}
        </Button>
      </form>
    </div>
  );
}
