import { isSameOrigin, timingSafeEqualText } from './security';

interface AuthEnv { ADMIN_USERNAME: string; ADMIN_PASSWORD: string }
interface Env extends AuthEnv { LOGIN_ATTEMPT_LIMITER: DurableObjectNamespace }
interface LoginAttemptLimiterStub { fetch(request: Request): Promise<Response> }
const cookieName = (request: Request) => new URL(request.url).protocol === 'https:' ? '__Host-console_session' : 'console_session';
const json = (body: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
const sessionCookie = (request: Request, value: string, maxAge: number) => {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${cookieName(request)}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${secure}`;
};
const encode = (value: string) => btoa(value).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
async function signature(value: string, secret: string) { const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return encode(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))))); }
async function sessionValue(username: string, secret: string) { const payload = `${username}:${Date.now()}`; return `${encode(payload)}.${await signature(payload, secret)}`; }
export async function isAuthenticated(request: Request, env: AuthEnv) { const raw = request.headers.get('Cookie')?.match(new RegExp(`(?:^|;\\s*)${cookieName(request)}=([^;]+)`))?.[1]; if (!raw) return false; const [payload, sig] = raw.split('.'); if (!payload || !sig) return false; let decoded = ''; try { const padding = (4 - (payload.length % 4)) % 4; decoded = atob(payload.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat(padding)); } catch { return false; } const [username, stamp] = decoded.split(':'); const timestamp = Number(stamp); const now = Date.now(); if (username !== env.ADMIN_USERNAME || !Number.isFinite(timestamp) || timestamp > now + 60_000 || now - timestamp > 86400000) return false; return timingSafeEqualText(await signature(decoded, env.ADMIN_PASSWORD), sig); }
async function requestLoginLimiter(limiter: LoginAttemptLimiterStub, path: string, clientIp: string): Promise<Response | null> {
  try {
    return await limiter.fetch(new Request(`https://login-attempt-limiter/${path}`, {
      method: 'POST',
      headers: { 'x-client-ip': clientIp },
    }));
  } catch (error) {
    console.error('Login attempt limiter request failed.', error);
    return null;
  }
}

export const onRequest = async ({ request, env }: { request: Request; env: Env }) => {
  if (request.method === 'GET') return json({ authenticated: await isAuthenticated(request, env) });
  if (request.method !== 'POST') return json({ error: '方法不允许。' }, 405);
  if (!isSameOrigin(request)) return json({ error: '来源不受信任。' }, 403);

  const input = await request.json().catch(() => ({})) as Record<string, string>;
  if (input.action === 'logout') return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(request, '', 0) });
  if (!env.LOGIN_ATTEMPT_LIMITER) return json({ error: '登录限速服务未配置。' }, 503);
  const clientIp = request.headers.get('CF-Connecting-IP')?.trim();
  if (!clientIp || clientIp.length > 45) return json({ error: '无法识别登录来源。' }, 503);

  const limiter = env.LOGIN_ATTEMPT_LIMITER.getByName(`${env.ADMIN_USERNAME}:${clientIp}`);
  const limitResult = await requestLoginLimiter(limiter, 'check', clientIp);
  if (!limitResult) return json({ error: '登录限速服务不可用。' }, 503);
  if (limitResult.status === 429) {
    const retryAfter = limitResult.headers.get('retry-after');
    if (!retryAfter || !/^[1-9]\d*$/.test(retryAfter)) return json({ error: '登录限速服务不可用。' }, 503);
    return json({ error: '登录尝试过于频繁，请稍后重试。' }, 429, { 'retry-after': retryAfter });
  }
  if (limitResult.status !== 204) return json({ error: '登录限速服务不可用。' }, 503);

  const usernameOk = input.username === env.ADMIN_USERNAME;
  const passwordOk = await timingSafeEqualText(input.password, env.ADMIN_PASSWORD);
  if (!usernameOk || !passwordOk) return json({ error: '账号或密码错误。' }, 401);

  const resetResult = await requestLoginLimiter(limiter, 'reset', clientIp);
  if (!resetResult || resetResult.status !== 204) return json({ error: '登录限速服务不可用。' }, 503);
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(request, await sessionValue(env.ADMIN_USERNAME, env.ADMIN_PASSWORD), 86400) });
};
