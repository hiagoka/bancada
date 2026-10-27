import { describe, expect, it } from 'vitest';
import { iconFor, normalize } from './iconFor';

describe('normalize', () => {
  it('tira acentos e caixa', () => {
    expect(normalize('ÁUDIO Acessórios')).toBe('audio acessorios');
  });
});

describe('iconFor', () => {
  it.each([
    ['Teclados', 'Teclado Mecânico 75%', 'keyboard'],
    ['Mouses', 'Mouse Sem Fio Ergonômico', 'mouse'],
    ['Áudio', 'Headset com Cancelamento de Ruído', 'headset'],
    ['Acessórios', 'Suporte de Monitor Articulado', 'stand'],
    ['Acessórios', 'Hub USB-C 7 em 1', 'hub'],
    ['Casa', 'Caneca Térmica Dev', 'mug'],
  ])('%s / %s -> %s (os 6 produtos do seed)', (category, name, kind) => {
    expect(iconFor(category, name)).toBe(kind);
  });

  it.each([
    ['TECLADOS', 'keyboard'],
    ['teclado', 'keyboard'],
    ['Mouses', 'mouse'],
    ['ÁUDIO', 'headset'],
    ['audio', 'headset'],
    ['Canecas', 'mug'],
  ])('só pela categoria %s -> %s (sem acento/caixa)', (category, kind) => {
    expect(iconFor(category)).toBe(kind);
  });

  it('o nome vence a categoria genérica', () => {
    expect(iconFor('Acessórios', 'Hub USB')).toBe('hub');
  });

  it.each([
    ['Acessórios', 'Cabo trançado'],
    ['Outros', ''],
    ['', ''],
  ])('sem pista (%s / %s): ícone genérico', (category, name) => {
    expect(iconFor(category, name)).toBe('generic');
  });

  it('"mouse" não casa dentro de outras palavras', () => {
    expect(iconFor('Acessórios', 'Mousepad grande')).toBe('generic');
  });
});
