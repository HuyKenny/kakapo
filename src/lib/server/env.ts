import { env as cfEnv } from 'cloudflare:workers';

export interface AppEnv {
  DB: D1Database;
  SNAPSHOTS?: R2Bucket;
  ASSETS?: Fetcher;
  IMPORTER?: Fetcher;
  RL_EVENTS?: RateLimit;
  RL_ADMIN?: RateLimit;
  RL_GO?: RateLimit;
  ENVIRONMENT?: string;
  SITE_URL?: string;
  ALLOWED_HOSTS?: string;
  RL_SEARCH?: RateLimit;
  REQUIRE_ACCESS_EVERYWHERE?: string;
  ANALYTICS_ENABLED?: string;
  GA4_ID?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ADMIN_DEV_BYPASS?: string;
  CSRF_SECRET?: string;
  IP_HASH_SALT?: string;
  IMPORT_SHARED_SECRET?: string;
  GO_SECRET?: string;
}

export function getEnv(): AppEnv {
  return cfEnv as unknown as AppEnv;
}

/** local/test only — never true in staging/production even if a variable leaks in. */
export function isLocal(e: AppEnv = getEnv()): boolean {
  return e.ENVIRONMENT === 'local' || e.ENVIRONMENT === 'test';
}

export function siteUrl(e: AppEnv = getEnv()): string {
  return (e.SITE_URL || 'https://kakapo.cz').replace(/\/$/, '');
}

export function isProduction(e: AppEnv = getEnv()): boolean {
  return e.ENVIRONMENT === 'production';
}

export function allowedHosts(e: AppEnv = getEnv()): string[] {
  return (e.ALLOWED_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}
