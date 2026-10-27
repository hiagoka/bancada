export const DEFAULT_ADMIN_PATH = '/admin/produtos';

const MAX_LENGTH = 2000;
// Caracteres de controle (inclui CR/LF/TAB) e barra invertida: navegadores as tratam como "/".
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\u0000-\u001f\u007f\\]/;
const ADMIN_PREFIX = /^\/admin(?:$|[/?#])/;
const LOGIN_PREFIX = /^\/admin\/login(?:$|[/?#])/;

function hasDotSegment(path: string): boolean {
  return path.split('/').some((segment) => {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return true; // percent-encoding inválido: não confie
    }
    return decoded === '..' || decoded === '.' || decoded.includes('/'); // %2f escondido
  });
}

// O parâmetro `next` vem da URL (controlada por quem montou o link): só vale caminho INTERNO do
// admin. Qualquer dúvida devolve o destino padrão. O fragmento é descartado.
export function sanitizeNext(value: string | null | undefined): string {
  if (!value || value.length > MAX_LENGTH) return DEFAULT_ADMIN_PATH;
  if (!ADMIN_PREFIX.test(value) || LOGIN_PREFIX.test(value)) return DEFAULT_ADMIN_PATH;
  if (FORBIDDEN.test(value)) return DEFAULT_ADMIN_PATH;

  let url: URL;
  try {
    url = new URL(value, 'http://interno.invalid');
  } catch {
    return DEFAULT_ADMIN_PATH;
  }
  if (url.origin !== 'http://interno.invalid') return DEFAULT_ADMIN_PATH;
  if (hasDotSegment(url.pathname)) return DEFAULT_ADMIN_PATH;
  // Decodificado também não pode virar barra invertida, controle ou "//".
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    return DEFAULT_ADMIN_PATH;
  }
  if (FORBIDDEN.test(decodedPath) || decodedPath.startsWith('//')) return DEFAULT_ADMIN_PATH;
  if (!ADMIN_PREFIX.test(url.pathname) || LOGIN_PREFIX.test(url.pathname)) {
    return DEFAULT_ADMIN_PATH;
  }
  return url.pathname + url.search;
}

// Caminho do login guardando a página pedida (codificada) para voltar depois.
export function loginUrl(pathname: string, search: string): string {
  return `/admin/login?next=${encodeURIComponent(pathname + search)}`;
}
