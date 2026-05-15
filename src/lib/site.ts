const nodeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
const configuredBase = nodeProcess?.env?.BASE_PATH ?? import.meta.env.BASE_URL;

const base = `/${(configuredBase || '/').replace(/^\/+|\/+$/g, '')}`;
const normalizedBase = base === '/' ? '/' : `${base}/`;

export const withBase = (path: string) => `${normalizedBase}${path.replace(/^\//, '')}`;
