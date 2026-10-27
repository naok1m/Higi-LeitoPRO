import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export const projectRoot = path.resolve(import.meta.dirname, '..', '..');

// Variáveis já definidas no ambiente têm prioridade; o .env.local (desenvolvimento)
// é lido antes do .env (servidor), então ele vence quando os dois existem.
if (process.env.HIGI_SKIP_ENV_FILE !== '1') {
  for (const file of ['.env.local', '.env']) {
    const fullPath = path.join(projectRoot, file);
    if (existsSync(fullPath)) process.loadEnvFile(fullPath);
  }
}

const optionalText = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().optional(),
);

const schema = z.object({
  DATABASE_URL: z.string({ error: 'DATABASE_URL não foi configurada.' })
    .trim()
    .min(1, 'DATABASE_URL não foi configurada.')
    .refine((value) => /^postgres(ql)?:\/\//.test(value), 'DATABASE_URL deve começar com postgres://'),
  HIGI_DB_POOL_MAX: z.coerce.number().int().min(2).max(50).default(10),
  HOST: optionalText.default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HIGI_TLS_PFX_PATH: optionalText,
  HIGI_TLS_PFX_PASSPHRASE: optionalText,
  HIGI_BASE_PATH: optionalText.refine(
    (value) => value === undefined || /^(\/[A-Za-z0-9._-]+)+\/?$/.test(value),
    'HIGI_BASE_PATH deve ser vazio ou algo como /higi',
  ),
  HIGI_ADMIN_EMAIL: optionalText,
  HIGI_WEBHOOK_URL: optionalText,
  HIGI_WEBHOOK_SECRET: optionalText,
});

const validateWebhook = (url, secret) => {
  if (url) {
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new Error('HIGI_WEBHOOK_URL deve conter uma URL válida.');
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('HIGI_WEBHOOK_URL deve usar HTTP ou HTTPS.');
    }
    if (parsedUrl.username || parsedUrl.password) {
      throw new Error('Não inclua credenciais na HIGI_WEBHOOK_URL; configure HIGI_WEBHOOK_SECRET.');
    }
  }
  if (secret && !url) throw new Error('HIGI_WEBHOOK_SECRET exige HIGI_WEBHOOK_URL.');
};

let cachedConfig = null;

export const getConfig = () => {
  if (cachedConfig) return cachedConfig;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `- ${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`Configuração inválida no arquivo .env:\n${issues}`);
  }
  const env = parsed.data;
  validateWebhook(env.HIGI_WEBHOOK_URL, env.HIGI_WEBHOOK_SECRET);
  if (env.HIGI_TLS_PFX_PASSPHRASE && !env.HIGI_TLS_PFX_PATH) {
    throw new Error('HIGI_TLS_PFX_PASSPHRASE exige HIGI_TLS_PFX_PATH.');
  }

  cachedConfig = {
    databaseUrl: env.DATABASE_URL,
    dbPoolMax: env.HIGI_DB_POOL_MAX,
    host: env.HOST,
    port: env.PORT,
    tls: env.HIGI_TLS_PFX_PATH
      ? {
        pfxPath: path.resolve(projectRoot, env.HIGI_TLS_PFX_PATH),
        passphrase: env.HIGI_TLS_PFX_PASSPHRASE,
      }
      : null,
    basePath: (env.HIGI_BASE_PATH || '').replace(/\/+$/, ''),
    adminBootstrapEmail: (env.HIGI_ADMIN_EMAIL || '').toLowerCase(),
    webhook: { url: env.HIGI_WEBHOOK_URL || '', secret: env.HIGI_WEBHOOK_SECRET || '' },
    distDir: path.join(projectRoot, 'dist'),
  };
  return cachedConfig;
};
