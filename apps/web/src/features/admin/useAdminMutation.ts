import {
  useMutation,
  type UseMutationOptions,
  type UseMutationResult,
} from '@tanstack/react-query';

type AdminMutationOptions<TData, TError, TVariables, TContext> = Omit<
  UseMutationOptions<TData, TError, TVariables, TContext>,
  'mutationKey' | 'retry'
> & {
  // Sem o prefixo 'admin': o helper o acrescenta (ex.: ['product', 'save'] vira ['admin','product','save']).
  mutationKey: readonly [string, ...unknown[]];
};

// TODA mutação do admin passa por aqui (D30): a mutationKey sempre começa por 'admin', então um
// 401 derruba a sessão (MutationCache em queryClient.ts). Sem retry: mutação não se repete sozinha.
export function useAdminMutation<
  TData = unknown,
  TError = Error,
  TVariables = void,
  TContext = unknown,
>({
  mutationKey,
  ...options
}: AdminMutationOptions<TData, TError, TVariables, TContext>): UseMutationResult<
  TData,
  TError,
  TVariables,
  TContext
> {
  const key = mutationKey[0] === 'admin' ? mutationKey : (['admin', ...mutationKey] as const);
  return useMutation<TData, TError, TVariables, TContext>({
    ...options,
    mutationKey: key,
    retry: false,
  });
}
