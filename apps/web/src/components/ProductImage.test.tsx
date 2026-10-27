// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProductImage } from './ProductImage';

const base = { name: 'Teclado Mecânico', category: 'Teclados' };

describe('ProductImage', () => {
  it('com imageUrl: mostra a imagem com alt = nome do produto', () => {
    render(<ProductImage product={{ ...base, imageUrl: 'https://cdn.test/a.png' }} />);
    const img = screen.getByRole('img', { name: 'Teclado Mecânico' });
    expect(img.getAttribute('src')).toBe('https://cdn.test/a.png');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(document.querySelector('[data-icon]')).toBeNull();
  });

  it('decorative: alt vazio (o nome já está escrito ao lado; evita leitura dupla)', () => {
    const { container } = render(
      <ProductImage product={{ ...base, imageUrl: 'https://cdn.test/a.png' }} decorative />,
    );
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('');
    expect(screen.queryByRole('img')).toBeNull(); // alt vazio = presentation
  });

  it('sem imagem: mostra o ícone da categoria (decorativo, aria-hidden)', () => {
    const { container } = render(<ProductImage product={{ ...base, imageUrl: null }} />);
    expect(screen.queryByRole('img')).toBeNull();
    const icon = container.querySelector('[data-icon]');
    expect(icon?.getAttribute('data-icon')).toBe('keyboard');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
  });

  it('se a imagem falhar ao carregar (onError): troca pelo ícone', () => {
    const { container } = render(
      <ProductImage product={{ ...base, imageUrl: 'https://cdn.test/quebrada.png' }} />,
    );
    fireEvent.error(screen.getByRole('img'));
    expect(screen.queryByRole('img')).toBeNull();
    expect(container.querySelector('[data-icon="keyboard"]')).not.toBeNull();
  });

  it('uma imagem nova (outra URL) volta a ser tentada depois de uma falha', () => {
    const { rerender } = render(
      <ProductImage product={{ ...base, imageUrl: 'https://cdn.test/a.png' }} />,
    );
    fireEvent.error(screen.getByRole('img'));
    rerender(<ProductImage product={{ ...base, imageUrl: 'https://cdn.test/b.png' }} />);
    expect(screen.getByRole('img').getAttribute('src')).toBe('https://cdn.test/b.png');
  });
});
