import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { logout } from '../../api/auth';
import { clearAdminSession } from './session';

// "Sair": chama a API, mas a sessão local é limpa MESMO que a chamada falhe (rede, 5xx): quem
// clicou em Sair não pode continuar vendo dados do admin. Depois, vai ao login (replace), e voltar
// no histórico cai de novo no RequireAdmin, sem cache.
export function useLogout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  const run = async (): Promise<void> => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    let failed = false;
    try {
      await logout();
    } catch {
      failed = true; // segue: a limpeza local acontece de qualquer jeito
    } finally {
      // Se a API não confirmou, o cookie pode continuar válido: a tela de login avisa.
      navigate('/admin/login', { replace: true, state: failed ? { logoutFailed: true } : null });
      clearAdminSession(queryClient);
      busy.current = false;
      setPending(false);
    }
  };

  return { logout: run, pending };
}
