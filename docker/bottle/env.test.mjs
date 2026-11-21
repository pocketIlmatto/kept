import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { bottleEnv, shellEnv } from './env.mjs';

const base = {
  BOTTLE_APP_NAME: 'kept',
  BOTTLE_ZONE_DOMAIN: 'example.org',
  BOTTLE_APP_DATA_DIR: '/data/app_data/kept',
};
test('derives HTTPS URL and stores every persistent app path under the mounted directory', () => {
  const env = bottleEnv(base);
  assert.equal(env.KEPT_PUBLIC_URL, 'https://kept.example.org');
  for (const [key, value] of Object.entries(env)) {
    if (key.endsWith('_DIR') || key.endsWith('_FILE'))
      assert.ok(value.startsWith(`${base.BOTTLE_APP_DATA_DIR}/`));
  }
  assert.equal(env.KEPT_HA, '0');
  assert.equal(env.KEPT_HA_TRUST_GROUPS, '0');
  assert.equal(env.KEPT_REFERRER_POLICY, 'same-origin');
  assert.equal(env.KEPT_DB_OWNER_PASSWORD_FILE, undefined);
});
test('supports a renamed app and local HTTP Bottle instances', () => {
  assert.equal(
    bottleEnv({ ...base, BOTTLE_APP_NAME: 'my-inventory' }).KEPT_PUBLIC_URL,
    'https://my-inventory.example.org',
  );
  assert.equal(
    bottleEnv({
      ...base,
      BOTTLE_ZONE_DOMAIN: 'lvh.me:8080',
      BOTTLE_ROUTER_PUBLIC_URL: 'http://lvh.me:8080',
    }).KEPT_PUBLIC_URL,
    'http://kept.lvh.me:8080',
  );
});
test('allows an explicit local test URL without platform domain variables', () => {
  assert.equal(
    bottleEnv({ BOTTLE_APP_DATA_DIR: '/state', KEPT_PUBLIC_URL: 'http://localhost:8080/' })
      .KEPT_PUBLIC_URL,
    'http://localhost:8080',
  );
});
test('refuses missing persistence, unsafe paths and malformed addresses before touching data', () => {
  for (const data of ['', '/', '/x/..', 'relative'])
    assert.throws(() => bottleEnv({ ...base, BOTTLE_APP_DATA_DIR: data }));
  for (const url of [
    'ftp://example.org',
    'https://a:b@example.org',
    'https://example.org/path',
    'https://example.org/?x=1',
    'https://example.org/#x',
  ]) {
    assert.throws(() => bottleEnv({ ...base, KEPT_PUBLIC_URL: url }));
  }
  assert.throws(() => bottleEnv({ ...base, BOTTLE_APP_NAME: 'bad/name' }));
  assert.throws(() => bottleEnv({ ...base, BOTTLE_ROUTER_PUBLIC_URL: 'https://other.org' }));
});
test('shell output treats quotes and command substitution as literal path characters', () => {
  const env = bottleEnv({ ...base, BOTTLE_APP_DATA_DIR: "/data/it's $(false) `false`" });
  const result = execFileSync('bash', ['-c', `${shellEnv(env)}\nprintf '%s' "$KEPT_CONFIG_DIR"`], {
    encoding: 'utf8',
  });
  assert.equal(result, env.KEPT_CONFIG_DIR);
});
