import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const raiz = new URL('../', import.meta.url);

test('site tem index.html e _headers com CSP', async () => {
  await access(new URL('site/index.html', raiz));
  const headers = await readFile(new URL('site/_headers', raiz), 'utf8');
  assert.match(headers, /Content-Security-Policy:/);
});

test('_headers: CSP estrita e os cabeçalhos de segurança', async () => {
  const headers = await readFile(new URL('site/_headers', raiz), 'utf8');
  const csp = /Content-Security-Policy: (.+)/.exec(headers)[1];
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|unsafe-hashes|\s\*|data:|https?:[\s;]/);
  for (const d of ["default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self';", "object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'"]) {
    assert.ok(csp.includes(d), `CSP sem ${d}`);
  }
  for (const c of ['Strict-Transport-Security: max-age=31536000', 'X-Content-Type-Options: nosniff', 'X-Frame-Options: DENY',
    'Referrer-Policy: strict-origin-when-cross-origin', 'Permissions-Policy:', 'Cross-Origin-Opener-Policy: same-origin']) {
    assert.ok(headers.includes(c), `falta ${c}`);
  }
  assert.doesNotMatch(headers, /interest-cohort/);
});

test('package.json não tem dependências', async () => {
  const pacote = JSON.parse(await readFile(new URL('package.json', raiz), 'utf8'));
  assert.equal(pacote.dependencies, undefined);
  assert.equal(pacote.devDependencies, undefined);
});
