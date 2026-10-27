import { MAX_INT4 } from '@bancada/contracts';

const priceFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

// Centavos inteiros -> "R$ 1.349,90" (com espaço não separável entre R$ e o valor).
export function formatPrice(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new RangeError(`Valor em centavos inválido: ${cents}`);
  }
  return priceFormatter.format(cents / 100);
}

// "dd/MM/aaaa HH:mm". `timeZone` existe para os testes; no navegador vale o fuso do usuário.
export function formatDateTime(value: string | Date, timeZone?: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new RangeError(`Data inválida: ${String(value)}`);
  const parts = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
}

// Milhar com pontos ("1.349,90"), só vírgula ("1349,90") ou inteiro ("349").
const BR_FORMAT = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/;
// "349.90" / "349.9": ponto decimal sem vírgula (1 ou 2 casas; com 3 seria milhar).
const DOT_DECIMAL = /^(\d+)\.(\d{1,2})$/;

// Preço digitado em reais -> centavos inteiros, sem ponto flutuante. null = entrada inválida
// (ou acima do teto de INTEGER). Aceita "R$" opcional. A validação "maior que zero" é do schema.
export function parsePriceToCents(input: string): number | null {
  const text = input.trim().replace(/^R\$\s*/, '');
  const match = BR_FORMAT.exec(text) ?? DOT_DECIMAL.exec(text);
  if (!match) return null;
  const reais = match[1]!.replaceAll('.', '');
  const decimals = (match[2] ?? '').padEnd(2, '0');
  const cents = Number(reais) * 100 + Number(decimals);
  return Number.isSafeInteger(cents) && cents <= MAX_INT4 ? cents : null;
}
