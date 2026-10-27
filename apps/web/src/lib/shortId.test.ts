import { describe, expect, it } from 'vitest';
import { shortId } from './shortId';

describe('shortId', () => {
  it('8 primeiros caracteres em maiúsculas', () => {
    expect(shortId('3f2504e0-4f89-4d3a-9a0c-0305e82c3301')).toBe('3F2504E0');
  });
});
