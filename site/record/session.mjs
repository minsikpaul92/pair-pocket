// Test-login helpers for a local run (backend/.env must set TEST_LOGIN_PASSWORD
// and a MONGODB_DB_NAME ending in _dev). See docs/test-login.md.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const APP = process.env.APP_URL ?? 'http://localhost:3000';

function password() {
  if (process.env.TEST_LOGIN_PASSWORD) return process.env.TEST_LOGIN_PASSWORD;
  const env = readFileSync(fileURLToPath(new URL('../../backend/.env', import.meta.url)), 'utf8');
  const line = env.split(/\r?\n/).find((l) => l.startsWith('TEST_LOGIN_PASSWORD='));
  if (!line) throw new Error('TEST_LOGIN_PASSWORD is not set');
  return line.slice('TEST_LOGIN_PASSWORD='.length).trim();
}

async function post(path, body) {
  const res = await fetch(`${APP}/api/auth/test-login${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, password: password() }),
  });
  if (!res.ok) throw new Error(`test-login${path} answered ${res.status}`);
  return res.json();
}

// Every account back to the linked couples with a month of demo data.
export const resetDemo = () => post('/reset', { preset: 'demo' });

// One-time sign-in address for a test account (tester3 and tester4 are English).
export async function signInUrl(account = 'tester3', locale = 'en') {
  const { code } = await post('', { account, ready: true });
  return `${APP}/${locale}/auth/callback?code=${encodeURIComponent(code)}`;
}

// `node session.mjs [--reset] [account]` prints a sign-in address for exploring.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--reset')) console.error('reset:', await resetDemo());
  console.log(await signInUrl(args.find((a) => !a.startsWith('--'))));
}
