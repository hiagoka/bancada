export type IconKind = 'keyboard' | 'mouse' | 'headset' | 'stand' | 'hub' | 'mug' | 'generic';

// Sem acento e em minúsculas, para casar "Áudio", "audio", "ÁUDIO"...
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

const RULES: [IconKind, RegExp][] = [
  ['keyboard', /teclad|keyboard/],
  ['mouse', /\bmouses?\b/],
  ['headset', /headset|fone|audio|headphone/],
  ['stand', /suporte|monitor|stand|braco/],
  ['hub', /\bhub\b|usb|dock/],
  ['mug', /caneca|copo|xicara|mug/],
];

// O nome do produto vale mais que a categoria (várias coisas moram em "Acessórios").
export function iconFor(category: string, name = ''): IconKind {
  for (const text of [normalize(name), normalize(category)]) {
    for (const [kind, pattern] of RULES) if (pattern.test(text)) return kind;
  }
  return 'generic';
}
