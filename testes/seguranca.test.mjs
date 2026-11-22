// Cabeçalhos de segurança do site (site/_headers; o build copia para dist/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const raiz = new URL('../', import.meta.url);

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
