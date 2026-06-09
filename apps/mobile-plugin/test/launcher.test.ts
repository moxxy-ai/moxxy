import { describe, expect, it } from 'vitest';
import {
  buildExpoStartArgs,
  mobileGatewayPlugin,
  resolveMobileExpoOptions,
  resolveMobileGatewayOptions,
} from '../serve.js';

describe('mobile launcher channel', () => {
  it('uses the default gateway runtime options when no flags are passed', () => {
    expect(resolveMobileGatewayOptions()).toEqual({
      host: '0.0.0.0',
    });
  });

  it('resolves gateway runtime flags for direct plugin startup', () => {
    expect(
      resolveMobileGatewayOptions({
        host: '127.0.0.1',
        port: '18000',
        'api-port': '3800',
        token: 'bridge-token',
      }),
    ).toEqual({
      host: '127.0.0.1',
      port: 18000,
      apiUrl: 'http://127.0.0.1:3800',
      token: 'bridge-token',
    });
  });

  it('lets api-url override api-port', () => {
    expect(
      resolveMobileGatewayOptions({
        'api-url': 'http://192.168.0.20:3737',
        'api-port': '3800',
      }),
    ).toEqual({
      host: '0.0.0.0',
      apiUrl: 'http://192.168.0.20:3737',
    });
  });

  it('starts the Expo mobile app by default', () => {
    expect(resolveMobileExpoOptions()).toEqual({
      enabled: true,
      host: 'lan',
      port: 8081,
    });
  });

  it('can disable Expo startup for gateway-only runs', () => {
    expect(resolveMobileExpoOptions({ 'no-expo': true })).toEqual({
      enabled: false,
      host: 'lan',
      port: 8081,
    });
  });

  it('builds the Expo start command without opening an external browser', () => {
    expect(buildExpoStartArgs({ host: 'lan', port: 8081 })).toEqual([
      'run',
      'start',
      '--',
      '--host',
      'lan',
      '--port',
      '8081',
    ]);
  });

  it('exports a mobile channel with the open interactive command', () => {
    expect(mobileGatewayPlugin).toMatchObject({
      __moxxy: 'plugin',
      name: '@moxxy/mobile-gateway-plugin',
      channels: [
        expect.objectContaining({
          name: 'mobile',
          interactiveCommand: 'open',
        }),
      ],
    });
  });
});
