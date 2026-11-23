import { createRemoteJWKSet, jwtVerify } from 'jose';
import { accountPatch, accountSnapshot, keySyncDisabledField } from '@moxxy/desktop-ipc-contract/account-sync';

const namespace = 'moxxyDesktopV1';
export const maxBytes = 7000;

export function verifyDesktopSession(issuer, allowedOrigins, jwks = createRemoteJWKSet(new URL('/.well-known/jwks.json', issuer))) {
  return async (token) => {
    const { payload } = await jwtVerify(token, jwks, {
      issuer, algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'sid', 'sub', 'azp'],
    });
    if (!allowedOrigins.includes(payload.azp) || !/^user_[a-zA-Z0-9]+$/.test(payload.sub) ||
        typeof payload.sid !== 'string' || !/^sess_[a-zA-Z0-9]+$/.test(payload.sid) ||
        payload.sts === 'pending' || payload.act) throw new Error('Invalid session');
    return { user: payload.sub, session: payload.sid };
  };
}

export function createService({ verify, secret, request = fetch }) {
  const clerk = (path, init) => request('https://api.clerk.com/v1' + path, {
    ...init, headers: { authorization: 'Bearer ' + secret, 'content-type': 'application/json' },
    redirect: 'error', signal: AbortSignal.timeout(8000),
  });

  // Order changes to the same account on this service, including a concurrent
  // opt-out or removal. Unrelated accounts proceed independently.
  const writes = new Map();
  const write = async (user, operation) => {
    const pending = (writes.get(user) ?? Promise.resolve()).catch(() => {}).then(operation);
    writes.set(user, pending);
    try { return await pending; }
    finally { if (writes.get(user) === pending) writes.delete(user); }
  };

  return async (req, res) => {
    const end = (status, data) => {
      res.writeHead(status, { 'cache-control': 'no-store', 'content-type': 'application/json' });
      res.end(data === undefined ? undefined : JSON.stringify(data));
    };
    if (req.method === 'GET' && req.url === '/healthz') return end(200, { status: 'ok' });
    if (req.url !== '/v1/device-sync') return end(404);
    if (!['GET', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) return end(405);
    const token = /^Bearer ([^\s]+)$/.exec(req.headers.authorization ?? '')?.[1];
    if (!token) return end(401);
    let identity;
    try { identity = await verify(token); } catch { return end(401); }
    try {
      const session = await clerk('/sessions/' + identity.session);
      if (!session.ok) return end(session.status === 404 ? 401 : 503);
      const state = await session.json();
      if (state.status !== 'active' || state.user_id !== identity.user) return end(401);
      const path = '/users/' + identity.user;
      if (req.method === 'GET') {
        const user = await clerk(path);
        if (!user.ok) return end(503);
        const snapshot = (await user.json()).private_metadata?.[namespace];
        if (snapshot == null) return end(404);
        const parsed = accountSnapshot.safeParse(snapshot);
        return parsed.success ? end(200, parsed.data) : end(422);
      }
      let metadata = { private_metadata: { [namespace]: null } };
      if (req.method === 'PATCH' || req.method === 'PUT') {
        if (req.headers['content-type'] !== 'application/json') return end(415);
        let size = 0;
        const chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > maxBytes) return end(413);
          chunks.push(chunk);
        }
        let input;
        try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return end(400); }
        if (req.method === 'PUT') {
          if (typeof input?.enabled !== 'boolean' || Object.keys(input).length !== 1) return end(400);
          metadata = {
            public_metadata: { [keySyncDisabledField]: input.enabled ? null : true },
            ...(input.enabled ? {} : { private_metadata: { [namespace]: { keys: null } } }),
          };
        } else {
          const parsed = accountPatch.safeParse(input);
          if (!parsed.success) return end(400);
          metadata = { private_metadata: { [namespace]: parsed.data } };
        }
      }
      const status = await write(identity.user, async () => {
        if (req.method === 'PATCH') {
          const user = await clerk(path);
          if (!user.ok) return 503;
          if ((await user.json()).public_metadata?.[keySyncDisabledField] === true) return 409;
        }
        const saved = await clerk(path + '/metadata', {
          method: 'PATCH', body: JSON.stringify(metadata),
        });
        return saved.ok ? 204 : saved.status === 422 ? 422 : 503;
      });
      return end(status);
    } catch { return end(503); }
  };
}
