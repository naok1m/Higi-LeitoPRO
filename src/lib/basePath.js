// Prefixo em que o app está publicado (ex.: "/higi" atrás do proxy, "" na raiz).
// Vem do HIGI_BASE_PATH no momento do build (vite.config.js -> base).
export const BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, '');

// Monta um endereço absoluto do app a partir de um caminho como "/login" ou "/api/...".
export const appUrl = (path) => `${BASE_PATH}${path.startsWith('/') ? path : `/${path}`}`;
