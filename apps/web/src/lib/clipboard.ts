// Copia texto para a área de transferência, sem window.alert e sem lançar: devolve se deu certo.
// 1) navigator.clipboard.writeText (só existe em contexto seguro: HTTPS ou localhost);
// 2) fallback com <textarea> temporário (sem aria-hidden: ele recebe foco por alguns milissegundos) + document.execCommand('copy') (HTTP em IP de rede, navegador
//    antigo ou permissão negada). Fora da tela e somente leitura, para não abrir o teclado do celular.
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // permissão negada ou documento sem foco: tenta o fallback
    }
  }
  return copyWithSelection(text);
}

function copyWithSelection(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false;
  const previouslyFocused =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.left = '-9999px';
  area.style.opacity = '0';
  document.body.append(area);
  try {
    area.focus();
    area.select();
    area.setSelectionRange(0, text.length); // iOS: select() sozinho não seleciona textarea readonly
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
    previouslyFocused?.focus();
  }
}
