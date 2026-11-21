import path from 'node:path';
import { fileURLToPath } from 'node:url';

function origin(value) {
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('Kept needs an HTTP(S) origin without credentials, path, query or fragment');
  return url.origin;
}

export function bottleEnv(source) {
  const data = source.BOTTLE_APP_DATA_DIR;
  if (!data || !path.isAbsolute(data) || path.normalize(data) === '/') {
    throw new Error('BOTTLE_APP_DATA_DIR must be an absolute persistent directory other than /');
  }
  let publicUrl = source.KEPT_PUBLIC_URL;
  if (!publicUrl) {
    const name = source.BOTTLE_APP_NAME;
    const zone = source.BOTTLE_ZONE_DOMAIN;
    if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || !zone) {
      throw new Error('Set BOTTLE_APP_NAME and BOTTLE_ZONE_DOMAIN, or KEPT_PUBLIC_URL');
    }
    // The router URL preserves HTTP and the port on a local Bottle instance.
    const router = new URL(origin(source.BOTTLE_ROUTER_PUBLIC_URL || `https://${zone}`));
    if (router.host !== zone)
      throw new Error('BOTTLE_ROUTER_PUBLIC_URL must match BOTTLE_ZONE_DOMAIN');
    router.hostname = `${name}.${router.hostname}`;
    publicUrl = router.origin;
  }
  const config = path.join(data, 'config');
  return {
    KEPT_PUBLIC_URL: origin(publicUrl),
    KEPT_CONFIG_DIR: config,
    KEPT_DATA_DIR: path.join(data, 'kept'),
    KEPT_DATABASE_URL: 'postgres://kept_app:@127.0.0.1:5432/kept',
    KEPT_AUTH_DATABASE_URL: 'postgres://kept_auth:@127.0.0.1:5432/kept',
    KEPT_SYSTEM_DATABASE_URL: 'postgres://kept_system:@127.0.0.1:5432/kept',
    KEPT_DB_APP_PASSWORD_FILE: path.join(config, 'database/kept_app'),
    KEPT_DB_AUTH_PASSWORD_FILE: path.join(config, 'database/kept_auth'),
    KEPT_DB_SYSTEM_PASSWORD_FILE: path.join(config, 'database/kept_system'),
    KEPT_PORT: '8080',
    KEPT_ROLE: 'all',
    KEPT_HA: '0',
    KEPT_HA_TRUST_GROUPS: '0',
  };
}

export function shellEnv(env) {
  return Object.entries(env)
    .map(([key, value]) => `export ${key}='${value.replaceAll("'", "'\\''")}'`)
    .join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(shellEnv(bottleEnv(process.env)));
}
