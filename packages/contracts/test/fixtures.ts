export const uuid = '3f2504e0-4f89-4d3a-9a0c-0305e82c3301';
export const uuid2 = '6ba7b810-9dad-41d1-80b5-00c04fd430c8';
export const isoDate = '2026-01-15T12:00:00.000Z';

export function messagesOf(result: {
  success: boolean;
  error?: { issues: { message: string }[] };
}): string[] {
  return result.error?.issues.map((i) => i.message) ?? [];
}

export function omit<T extends object, K extends keyof T>(obj: T, key: K): Omit<T, K> {
  const copy = { ...obj };
  delete copy[key];
  return copy;
}
