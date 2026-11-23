import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { generateKeyPair, SignJWT } from 'jose';
import { createService, verifyDesktopSession } from './service.mjs';

test('checks issuer, signature, party, expiry and session claims', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const issuer = 'https://clerk.example.test';
  const origin = 'https://desktop.example.test';
  const verify = verifyDesktopSession(issuer, [origin], publicKey);
  const claims = { sid: 'sess_a', sub: 'user_a', azp: origin, iss: issuer };
  const sign = (changes = {}, key = privateKey) => new SignJWT({ ...claims, ...changes })
    .setIssuedAt().setExpirationTime(changes.exp ?? '1m').setProtectedHeader({ alg: 'RS256' }).sign(key);
  assert.deepEqual(await verify(await sign()), { user: 'user_a', session: 'sess_a' });
  for (const patch of [{ azp: 'elsewhere' }, { exp: 1 }, { iss: 'elsewhere' }, { sts: 'pending' }, { sid: undefined }]) {
    await assert.rejects(verify(await sign(patch)));
  }
  await assert.rejects(verify(await sign({}, (await generateKeyPair('RS256')).privateKey)));
});

test('scopes reads, merges and removal to the active session owner', async (t) => {
  let state = 'active';
  const privateMetadata = { unrelated: 'private' };
  const publicMetadata = {};
  // Clerk's metadata PATCH recursively merges nested fields and deletes nulls.
  function merge(target, patch) {
    for (const [key, value] of Object.entries(patch ?? {})) {
      if (value === null) delete target[key];
      else if (typeof value === 'object') merge(target[key] ??= {}, value);
      else target[key] = value;
    }
  }
  const request = async (url, init) => {
    assert.equal(init.headers.authorization, 'Bearer service-test');
    if (url.endsWith('/sessions/sess_test')) return Response.json({ status: state, user_id: 'user_test' });
    if (url.endsWith('/users/user_test')) return Response.json({ private_metadata: privateMetadata, public_metadata: publicMetadata });
    assert.equal(url, 'https://api.clerk.com/v1/users/user_test/metadata');
    const patch = JSON.parse(init.body);
    merge(privateMetadata, patch.private_metadata);
    merge(publicMetadata, patch.public_metadata);
    return Response.json({});
  };
  const verify = (token) => {
    assert.equal(token, 'session-test');
    return { session: 'sess_test', user: 'user_test' };
  };
  const server = createServer(createService({ verify, secret: 'service-test', request }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const endpoint = 'http://127.0.0.1:' + server.address().port + '/v1/device-sync';
  const send = (method, body, token = 'session-test') => fetch(endpoint, {
    method, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  assert.equal((await send('GET', undefined, 'invalid')).status, 401);
  assert.equal((await send('GET')).status, 404);
  const backup = { keys: { OPENAI_API_KEY: 'fake' }, prefs: { replySound: false } };
  assert.equal((await send('PATCH', backup)).status, 204);
  assert.equal((await send('PATCH', { prefs: { clerkUserId: 'other' } })).status, 400);
  assert.equal((await send('PATCH', { keys: { CLERK_SECRET_KEY: 'fake' } })).status, 400);
  assert.equal((await send('PATCH', { junk: 'a'.repeat(8000) })).status, 413);
  const result = await send('GET');
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await result.json(), backup);
  assert.equal((await send('PATCH', { keys: { GEMINI_API_KEY: 'second' } })).status, 204);
  assert.equal((await send('PATCH', { keys: { OPENAI_API_KEY: 'rotated' } })).status, 204);
  assert.deepEqual((await (await send('GET')).json()).keys, { OPENAI_API_KEY: 'rotated', GEMINI_API_KEY: 'second' });
  assert.equal((await send('PATCH', { keys: { GEMINI_API_KEY: null } })).status, 204);
  assert.deepEqual((await (await send('GET')).json()).keys, { OPENAI_API_KEY: 'rotated' });
  assert.equal((await send('PUT', { enabled: false })).status, 204);
  assert.equal(publicMetadata.moxxyAutoKeySyncDisabled, true);
  assert.deepEqual(await (await send('GET')).json(), { prefs: backup.prefs, keys: {} });
  // Another signed-in device can still have the old setting cached.
  assert.equal((await send('PATCH', backup)).status, 409);
  assert.equal((await send('PUT', { enabled: 'true' })).status, 400);
  assert.equal((await send('PUT', { enabled: true })).status, 204);
  assert.deepEqual(publicMetadata, {});
  assert.deepEqual((await (await send('GET')).json()).keys, {});
  assert.equal((await send('PATCH', backup)).status, 204);
  state = 'revoked';
  assert.equal((await send('GET')).status, 401);
  state = 'active';
  assert.equal((await send('DELETE')).status, 204);
  assert.equal(privateMetadata.unrelated, 'private');
  assert.equal((await send('GET')).status, 404);
});
