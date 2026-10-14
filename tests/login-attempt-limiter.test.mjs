import assert from 'node:assert/strict';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

Object.defineProperty(globalThis.crypto.subtle, 'timingSafeEqual', {
  value: (left, right) => timingSafeEqual(Buffer.from(left), Buffer.from(right)),
});

const transpile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const asModuleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;

const workerSource = await readFile(new URL('../status-worker/src/index.ts', import.meta.url), 'utf8');
const { LoginAttemptLimiter } = await import(asModuleUrl(transpile(workerSource)));
const securitySource = await readFile(new URL('../functions/api/security.ts', import.meta.url), 'utf8');
const securityUrl = asModuleUrl(transpile(securitySource));
const authSource = await readFile(new URL('../functions/api/auth.ts', import.meta.url), 'utf8');
const authModule = await import(asModuleUrl(transpile(authSource.replace("from './security'", `from '${securityUrl}'`))));

class MemoryStorage {
  values = new Map();
  transactionTail = Promise.resolve();
  alarmAt = null;

  async get(key) { return this.values.get(key); }
  async put(key, value) { this.values.set(key, value); }
  async delete(key) { return this.values.delete(key); }
  async setAlarm(value) { this.alarmAt = Number(value); }
  async deleteAlarm() { this.alarmAt = null; }

  async transaction(callback) {
    const previous = this.transactionTail;
    let release;
    this.transactionTail = new Promise(resolve => { release = resolve; });
    await previous;
    try { return await callback(this); } finally { release(); }
  }
}

const requestLimiter = (limiter, path, clientIp = '203.0.113.10') => limiter.fetch(new Request(`https://limiter.test/${path}`, {
  method: 'POST',
  headers: { 'x-client-ip': clientIp },
}));

function loginEnvironment() {
  const limiters = new Map();
  const env = {
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: 'correct horse battery staple',
    LOGIN_ATTEMPT_LIMITER: {
      getByName(name) {
        assert.match(name, /^admin:/);
        if (!limiters.has(name)) limiters.set(name, new LoginAttemptLimiter({ storage: new MemoryStorage() }));
        return limiters.get(name);
      },
    },
  };
  return env;
}

function loginRequest(username, password, clientIp = '203.0.113.10') {
  const headers = { 'content-type': 'application/json' };
  if (clientIp) headers['CF-Connecting-IP'] = clientIp;
  return new Request('https://site.test/api/auth', {
    method: 'POST',
    headers,
    body: JSON.stringify({ username, password }),
  });
}

test('durable limiter atomically caps concurrent checks and clears on reset', async () => {
  const storage = new MemoryStorage();
  const limiter = new LoginAttemptLimiter({ storage });
  const responses = await Promise.all(Array.from({ length: 8 }, () => requestLimiter(limiter, 'check')));
  assert.equal(responses.filter(response => response.status === 204).length, 5);
  const blocked = responses.filter(response => response.status === 429);
  assert.equal(blocked.length, 3);
  assert.ok(Number(blocked[0].headers.get('retry-after')) > 0);
  assert.equal((await requestLimiter(limiter, 'reset')).status, 204);
  assert.equal(storage.alarmAt, null);
  assert.equal((await requestLimiter(limiter, 'check')).status, 204);
});

test('durable alarm prunes expired attempts without deleting a renewed window', async () => {
  const originalNow = Date.now;
  let now = 1_800_000_000_000;
  Date.now = () => now;
  try {
    const storage = new MemoryStorage();
    const limiter = new LoginAttemptLimiter({ storage });
    assert.equal((await requestLimiter(limiter, 'check')).status, 204);
    const firstResetAt = storage.alarmAt;
    now = firstResetAt + 1;
    storage.alarmAt = null;
    await limiter.alarm();
    assert.equal(storage.values.size, 0);

    assert.equal((await requestLimiter(limiter, 'check')).status, 204);
    const renewedResetAt = storage.alarmAt;
    await limiter.alarm();
    assert.equal(storage.values.size, 1);
    assert.equal(storage.alarmAt, renewedResetAt);
  } finally {
    Date.now = originalNow;
  }
});

test('auth route limits failed passwords and preserves originless CLI login', async () => {
  const env = loginEnvironment();
  const success = await authModule.onRequest({ request: loginRequest('admin', env.ADMIN_PASSWORD), env });
  assert.equal(success.status, 200);
  assert.match(success.headers.get('set-cookie'), /HttpOnly/);

  const failures = await Promise.all(Array.from({ length: 5 }, () => authModule.onRequest({
    request: loginRequest('different username', 'wrong password'),
    env,
  })));
  assert.deepEqual(failures.map(response => response.status), [401, 401, 401, 401, 401]);
  const blocked = await authModule.onRequest({ request: loginRequest('admin', env.ADMIN_PASSWORD), env });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  assert.equal(blocked.headers.get('set-cookie'), null);
  const otherIp = await authModule.onRequest({
    request: loginRequest('admin', env.ADMIN_PASSWORD, '203.0.113.11'),
    env,
  });
  assert.equal(otherIp.status, 200);
});

test('auth route fails closed without the limiter and leaves logout available', async () => {
  const request = new Request('https://site.test/api/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'guess' }),
  });
  const unavailable = await authModule.onRequest({
    request,
    env: { ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'secret' },
  });
  assert.equal(unavailable.status, 503);

  const unknownIp = await authModule.onRequest({
    request: loginRequest('admin', 'guess', ''),
    env: loginEnvironment(),
  });
  assert.equal(unknownIp.status, 503);

  const logout = await authModule.onRequest({
    request: new Request('https://site.test/api/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'logout' }),
    }),
    env: { ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'secret' },
  });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
});

test('auth route returns service unavailable and logs limiter transport errors', async () => {
  const originalError = console.error;
  let logged = false;
  console.error = () => { logged = true; };
  try {
    const response = await authModule.onRequest({
      request: loginRequest('admin', 'guess'),
      env: {
        ADMIN_USERNAME: 'admin',
        ADMIN_PASSWORD: 'secret',
        LOGIN_ATTEMPT_LIMITER: { getByName: () => ({ fetch: async () => { throw new Error('DO unavailable'); } }) },
      },
    });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(logged, true);
  } finally {
    console.error = originalError;
  }
});
