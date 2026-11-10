// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

const user = userEvent.setup();

function Harness({
  onConfirm = vi.fn(),
  busy = false,
}: {
  onConfirm?: () => void;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <main>
        <button onClick={() => setOpen(true)}>Abrir</button>
        <button>Outro botão da página</button>
      </main>
      <ConfirmDialog
        open={open}
        title="Cancelar o pedido #ABC?"
        description="O estoque dos itens volta para a loja."
        confirmLabel="Cancelar pedido"
        cancelLabel="Voltar"
        busy={busy}
        onConfirm={onConfirm}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

const dialog = () => screen.getByRole('dialog');

// Safari e Firefox no Mac NÃO focam o botão ao clicar: activeElement fica no <body>. O chamador passa o
// opener explicitamente (event.currentTarget) e o foco volta a ELE.
function OpenerHarness() {
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  return (
    <>
      <button onClick={(event) => setOpener(event.currentTarget)}>Abrir sem foco</button>
      <ConfirmDialog
        open={opener !== null}
        opener={opener}
        title="Confirmar?"
        description="Descrição."
        confirmLabel="Confirmar"
        cancelLabel="Voltar"
        onConfirm={() => undefined}
        onCancel={() => setOpener(null)}
      />
    </>
  );
}

describe('ConfirmDialog: opener explícito', () => {
  it.each([
    ['Esc', () => user.keyboard('{Escape}')],
    ['Voltar', () => user.click(screen.getByRole('button', { name: 'Voltar' }))],
    [
      'clique no fundo',
      () => user.click(document.querySelector('.dialog-backdrop') as HTMLElement),
    ],
  ])(
    'fechar por %s devolve o foco ao opener mesmo sem ele ter recebido foco no clique',
    async (_n, close) => {
      render(<OpenerHarness />);
      const opener = screen.getByRole('button', { name: 'Abrir sem foco' });
      fireEvent.click(opener); // clique sem foco, como no Safari
      expect(document.activeElement).not.toBe(opener);
      await close();
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(opener);
    },
  );
});

describe('ConfirmDialog', () => {
  it('fechado: nada na tela', () => {
    render(<Harness />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('aberto: role=dialog, aria-modal, título e descrição ligados, foco no botão seguro (Voltar)', async () => {
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    expect(dialog().getAttribute('aria-modal')).toBe('true');
    expect(screen.getByRole('dialog', { name: 'Cancelar o pedido #ABC?' })).toBeTruthy();
    expect(dialog().getAttribute('aria-describedby')).toBeTruthy();
    expect(
      document.getElementById(dialog().getAttribute('aria-describedby') ?? '')?.textContent,
    ).toBe('O estoque dos itens volta para a loja.');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Voltar' }));
  });

  it('o resto da página fica inerte enquanto o diálogo está aberto e volta depois', async () => {
    render(<Harness />);
    const main = document.querySelector('main')?.parentElement as HTMLElement;
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    expect(main.hasAttribute('inert')).toBe(true);
    await user.keyboard('{Escape}');
    expect(main.hasAttribute('inert')).toBe(false);
  });

  it('foco preso: Tab e Shift+Tab ciclam entre os dois botões', async () => {
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    const back = screen.getByRole('button', { name: 'Voltar' });
    const confirm = screen.getByRole('button', { name: 'Cancelar pedido' });
    expect(document.activeElement).toBe(back);
    await user.tab();
    expect(document.activeElement).toBe(confirm);
    await user.tab();
    expect(document.activeElement).toBe(back);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(confirm);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(back);
  });

  it('Esc fecha e devolve o foco a quem abriu', async () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Abrir' });
    await user.click(opener);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('"Voltar" fecha sem confirmar', async () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    await user.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('clicar fora (no fundo) fecha', async () => {
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    await user.click(document.querySelector('.dialog-backdrop') as HTMLElement);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('clicar dentro do diálogo não fecha', async () => {
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    await user.click(screen.getByText('O estoque dos itens volta para a loja.'));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('confirmar chama onConfirm uma vez', async () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    await user.click(screen.getByRole('button', { name: 'Cancelar pedido' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('ocupado: botões aria-disabled, confirmar não repete e Esc não fecha', async () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} busy />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    const confirm = screen.getByRole('button', { name: 'Cancelando…' });
    expect(confirm.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('button', { name: 'Voltar' }).getAttribute('aria-disabled')).toBe(
      'true',
    );
    await user.click(confirm);
    await user.keyboard('{Escape}');
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
