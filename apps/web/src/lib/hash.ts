const OFFSET_BASIS = 0xcbf29ce484222325n;
const PRIME = 0x100000001b3n;
const MASK = 0xffffffffffffffffn;

// FNV-1a de 64 bits sobre os bytes UTF-8, em 16 dígitos hex. Rápido e determinístico. NÃO é
// criptográfico: serve só para o sessionStorage não guardar texto legível (nome, e-mail). Existe
// porque crypto.subtle não está disponível em HTTP fora de localhost.
export function fnv1a64Hex(text: string): string {
  let hash = OFFSET_BASIS;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = (hash * PRIME) & MASK;
  }
  return hash.toString(16).padStart(16, '0');
}
