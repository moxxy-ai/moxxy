import { createServer } from 'node:http';
import { createService, verifyDesktopSession } from './service.mjs';

const { CLERK_SECRET_KEY, CLERK_ISSUER, DESKTOP_ORIGINS, PORT = '4781' } = process.env;
if (!CLERK_SECRET_KEY || !CLERK_ISSUER || !DESKTOP_ORIGINS ||
    new URL(CLERK_ISSUER).protocol !== 'https:') {
  throw new Error('Configure CLERK_SECRET_KEY, CLERK_ISSUER and DESKTOP_ORIGINS before startup.');
}
const verify = verifyDesktopSession(CLERK_ISSUER, DESKTOP_ORIGINS.split(',').map(s => s.trim()));
const server = createServer({ requestTimeout: 15000, headersTimeout: 10000 }, createService({ verify, secret: CLERK_SECRET_KEY }));
server.listen(Number(PORT), process.env.HOST ?? '127.0.0.1');
