// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { Footer } from './Footer';

describe('Footer: pagamento', () => {
  it('fala de Pix e do modo simulado, sem citar o Mercado Pago nem cartão ou boleto', () => {
    render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>,
    );
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/Pix/);
    expect(text).toMatch(/AbacatePay/);
    expect(text).toMatch(/simulado/i);
    expect(text).not.toMatch(/mercado/i);
    expect(text).not.toMatch(/cartão|boleto/i);
    expect(screen.getByRole('heading', { level: 2, name: 'Como pagar' })).toBeTruthy();
  });
});
