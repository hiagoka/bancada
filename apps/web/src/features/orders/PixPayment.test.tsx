// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyText } from '../../lib/clipboard';
import { resetServerClock } from '../../lib/serverClock';
import { ORDER_ID } from '../../test/orderFixtures';
import { PixPayment } from './PixPayment';

vi.mock('../../lib/clipboard', () => ({ copyText: vi.fn() }));
const mockCopy = vi.mocked(copyText);

const START = new Date('2026-11-10T12:00:00.000Z');
const BR_CODE = '00020101021226950014br.gov.bcb.pix0136teste-do-pix-copia-e-cola';
const QR = 'data:image/png;base64,iVBORw0KGgo=';
const pixIn = (seconds: number, overrides: Partial<{ qrCodeImage: string }> = {}) => ({
  brCode: BR_CODE,
  qrCodeImage: QR,
  expiresAt: new Date(START.getTime() + seconds * 1000).toISOString(),
  ...overrides,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  resetServerClock();
  mockCopy.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  resetServerClock();
});

function renderPix(seconds = 1800, onExpired: () => Promise<unknown> = async () => undefined) {
  const view = render(
    <MemoryRouter>
      <PixPayment orderId={ORDER_ID} pix={pixIn(seconds)} onExpired={onExpired} />
    </MemoryRouter>,
  );
  return { ...view, onExpired };
}
const tick = (seconds: number) =>
  act(async () => void (await vi.advanceTimersByTimeAsync(seconds * 1000)));
const liveTexts = () => screen.getAllByRole('status').map((e) => e.textContent);

describe('PixPayment: o que aparece', () => {
  it('título, passos, QR Code, copia e cola e contagem', () => {
    renderPix(754);
    expect(screen.getByRole('heading', { level: 2, name: 'Pague com Pix' })).toBeTruthy();
    expect(
      screen.getByRole('list', { name: 'Como pagar com Pix' }).querySelectorAll('li'),
    ).toHaveLength(3);
    const qr = screen.getByRole('img', { name: 'QR Code do Pix para pagar o pedido #3F2504E0' });
    expect(qr.getAttribute('src')).toBe(QR);
    expect(qr.getAttribute('width')).toBe('240');
    expect(qr.getAttribute('height')).toBe('240');
    const field = screen.getByLabelText('Pix copia e cola') as HTMLInputElement;
    expect(field.value).toBe(BR_CODE);
    expect(field.readOnly).toBe(true);
    expect(field.classList.contains('mono')).toBe(true);
    expect(screen.getByRole('button', { name: 'Copiar código' })).toBeTruthy();
    expect(screen.getByText('12:34')).toBeTruthy();
    expect(screen.getByText('12:34').tagName).toBe('TIME');
  });

  it('o QR Code fica num quadro de fundo CLARO, sem nada por cima', () => {
    renderPix();
    const frame = screen.getByRole('img', { name: /QR Code do Pix/ }).closest('.pix__qr');
    expect(frame).toBeTruthy();
    expect(frame?.querySelectorAll('*')).toHaveLength(1); // só a imagem
  });

  it.each([
    'https://rastreador.example/qr.png',
    'data:text/html;base64,PGI+',
    'javascript:alert(1)',
    '',
  ])(
    'QR Code que não é data URI PNG (%j): não renderiza <img>, mas o copia e cola continua',
    (qrCodeImage) => {
      render(
        <MemoryRouter>
          <PixPayment
            orderId={ORDER_ID}
            pix={pixIn(1800, { qrCodeImage })}
            onExpired={async () => undefined}
          />
        </MemoryRouter>,
      );
      expect(screen.queryByRole('img')).toBeNull();
      expect((screen.getByLabelText('Pix copia e cola') as HTMLInputElement).value).toBe(BR_CODE);
      expect(screen.getByText(/Não foi possível mostrar o QR Code/)).toBeTruthy();
    },
  );

  it('o campo seleciona todo o código ao receber o foco (para copiar à mão)', () => {
    renderPix();
    const field = screen.getByLabelText('Pix copia e cola') as HTMLInputElement;
    fireEvent.focus(field);
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(BR_CODE.length);
  });
});

describe('PixPayment: copiar', () => {
  it('sucesso: copia o brCode e confirma "Código copiado" numa região aria-live; o foco fica no botão', async () => {
    mockCopy.mockResolvedValue(true);
    renderPix();
    const button = screen.getByRole('button', { name: 'Copiar código' });
    button.focus();
    await act(async () => void fireEvent.click(button));
    expect(mockCopy).toHaveBeenCalledWith(BR_CODE);
    expect(liveTexts()).toContain('Código copiado.');
    expect(document.activeElement).toBe(button);
    const live = screen.getByText('Código copiado.');
    expect(live.closest('[aria-live]')?.getAttribute('aria-live')).toBe('polite');
  });

  it('a confirmação some depois de alguns segundos', async () => {
    mockCopy.mockResolvedValue(true);
    renderPix();
    await act(
      async () => void fireEvent.click(screen.getByRole('button', { name: 'Copiar código' })),
    );
    expect(liveTexts()).toContain('Código copiado.');
    await tick(5);
    expect(liveTexts()).not.toContain('Código copiado.');
  });

  it('falha do clipboard: avisa, SELECIONA o código para copiar à mão e nunca usa window.alert', async () => {
    mockCopy.mockResolvedValue(false);
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    renderPix();
    await act(
      async () => void fireEvent.click(screen.getByRole('button', { name: 'Copiar código' })),
    );
    expect(liveTexts().join(' ')).toContain('Não foi possível copiar automaticamente.');
    const field = screen.getByLabelText('Pix copia e cola') as HTMLInputElement;
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(BR_CODE.length);
    expect(document.activeElement).toBe(field);
    expect(alert).not.toHaveBeenCalled();
    expect(screen.queryByText('Código copiado.')).toBeNull();
  });

  it('clipboard que LANÇA também vira o aviso de falha (sem erro não tratado)', async () => {
    mockCopy.mockRejectedValue(new Error('boom'));
    renderPix();
    await act(
      async () => void fireEvent.click(screen.getByRole('button', { name: 'Copiar código' })),
    );
    expect(liveTexts().join(' ')).toContain('Não foi possível copiar automaticamente.');
  });

  it('copiar de novo depois da falha e dar certo troca o aviso', async () => {
    mockCopy.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    renderPix();
    const button = screen.getByRole('button', { name: 'Copiar código' });
    await act(async () => void fireEvent.click(button));
    await act(async () => void fireEvent.click(button));
    expect(liveTexts().join(' ')).toContain('Código copiado.');
    expect(liveTexts().join(' ')).not.toContain('Não foi possível copiar');
  });
});

describe('PixPayment: contagem e expiração', () => {
  it('a contagem desce e a região de anúncios só fala a cada minuto (não a cada segundo)', async () => {
    renderPix(125);
    const before = liveTexts().join('|');
    await tick(1);
    await tick(1);
    expect(liveTexts().join('|')).toBe(before);
    await tick(3); // faltam 120 s: virou o minuto
    expect(liveTexts().join(' ')).toContain('Faltam 2 minutos para o Pix expirar.');
    expect(screen.getByText('02:00')).toBeTruthy();
  });

  it('o número que desce não está numa região aria-live (o leitor não lê todo segundo)', () => {
    renderPix();
    const time = screen.getByText('30:00');
    expect(time.closest('[aria-live]')).toBeNull();
    expect(time.closest('[role="timer"]')).toBeNull();
  });

  it('ao zerar, faz UMA última consulta e, se o pedido continua PENDING, mostra que o tempo acabou', async () => {
    let finish!: () => void;
    const onExpired = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    renderPix(3, onExpired);
    await tick(2);
    expect(onExpired).not.toHaveBeenCalled();
    await tick(1);
    expect(onExpired).toHaveBeenCalledTimes(1);
    // enquanto a consulta não volta: confere o pagamento, ainda sem dizer que expirou
    expect(liveTexts().join(' ')).toContain('Conferindo se o pagamento chegou');
    expect(screen.queryByText('O tempo para pagar acabou.')).toBeNull();
    await act(async () => finish());
    expect(screen.getByText('O tempo para pagar acabou.')).toBeTruthy();
    await tick(30);
    expect(onExpired).toHaveBeenCalledTimes(1); // nunca repete
  });

  it('expirado: esconde QR Code, copia e cola e botão; mostra o caminho para um novo pedido', async () => {
    renderPix(1);
    await tick(1);
    expect(screen.getByText('O tempo para pagar acabou.')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByLabelText('Pix copia e cola')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copiar código' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Pague com Pix' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Voltar ao catálogo' }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('link', { name: 'Ir para o carrinho' }).getAttribute('href')).toBe(
      '/carrinho',
    );
    expect(document.body.textContent).not.toContain(BR_CODE);
  });

  it('o texto de expirado é VERDADEIRO: quem já pagou espera, quem não pagou faz novo pedido; nada de "não será cobrado"', async () => {
    renderPix(1);
    await tick(1);
    const panel = screen
      .getByText('O tempo para pagar acabou.')
      .closest('.order-panel') as HTMLElement;
    expect(panel.textContent).toContain(
      'Se você já pagou, aguarde: a confirmação pode levar alguns minutos e esta página atualiza sozinha. Se não pagou, faça um novo pedido.',
    );
    expect(panel.textContent).not.toMatch(/não será cobrado|nao sera cobrado/i);
    expect(panel.textContent).not.toMatch(/não vale mais/i);
  });

  it('a dica "Não pague de novo" aparece com o Pix ativo e SOME no estado expirado (sem contradição)', async () => {
    renderPix(2);
    expect(screen.getByText(/Não pague de novo/)).toBeTruthy();
    await tick(2);
    expect(screen.getByText('O tempo para pagar acabou.')).toBeTruthy();
    expect(screen.queryByText(/Não pague de novo/)).toBeNull();
  });

  it('enquanto confere o pagamento (zero, ainda sem resposta) a dica também some', async () => {
    renderPix(1, () => new Promise<void>(() => undefined));
    await tick(1);
    expect(screen.getByText(/Conferindo se o pagamento chegou/)).toBeTruthy();
    expect(screen.queryByText(/Não pague de novo/)).toBeNull();
  });

  it('a consulta final falhando (rede) também termina na tela de expirado, sem erro não tratado', async () => {
    renderPix(1, async () => {
      throw new Error('rede');
    });
    await tick(1);
    expect(screen.getByText('O tempo para pagar acabou.')).toBeTruthy();
  });

  it('já vencido ao montar: consulta na hora, uma vez, e mostra que acabou', async () => {
    const onExpired = vi.fn(async () => undefined);
    renderPix(-60, onExpired);
    await tick(0);
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(screen.getByText('O tempo para pagar acabou.')).toBeTruthy();
  });
});
