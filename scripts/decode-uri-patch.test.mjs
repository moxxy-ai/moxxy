import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
const mobileRequire = createRequire(new URL('../apps/mobile/package.json', import.meta.url));
const routerRequire = createRequire(mobileRequire.resolve('expo-router/package.json'));
const consumerRequire = createRequire(routerRequire.resolve('query-string/package.json'));
const decoderPath = consumerRequire.resolve('decode-uri-component');

test('URI decoding remains callable from the existing CommonJS query-string consumer', () => {
  const decode = consumerRequire('decode-uri-component');
  assert.equal(typeof decode, 'function');
  assert.equal(decode('Za%C5%BC%C3%B3%C5%82%C4%87+g%C4%99%C5%9Bl%C4%85'), 'Zażółć gęślą');
  assert.equal(decode('%FE%FF'), '\uFFFD\uFFFD');
  assert.equal(decode('%C2'), '\uFFFD');
  assert.equal(decode('%FF%41'), '%FFA');
  assert.equal(decode('%F0%9F%98%80'), '😀');
  assert.equal(decode('%FF%C5%BC%E2%82%AC%F0%9F%98%80'), '%FFż€😀');
  assert.equal(decode('%ED%A0%80%C0%AF'), '%ED%A0%80%C0%AF');
  assert.equal(decode('%E0%A4%A'), '%E0%A4%A');
  const query = consumerRequire('./index.js');
  assert.equal(query.parse('q=hello+world&lang=pl').q, 'hello world');
});

test('malformed percent-encoded input is decoded without recursion or excessive CPU', () => {
  const child = spawnSync(process.execPath, ['--input-type=commonjs', '--eval',
    "const assert = require('node:assert/strict'); const decode = require(process.argv[1]); assert.equal(decode('%FF%41'.repeat(1000)), '%FFA'.repeat(1000));",
    decoderPath,
  ], { encoding: 'utf8', timeout: 2000 });
  assert.equal(child.error, undefined, String(child.error));
  assert.equal(child.status, 0, child.stderr);
});
