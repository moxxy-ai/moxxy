import { describe, expect, it, vi } from 'vitest';
import type { PluginSetupSpec } from '@moxxy/sdk';
import { createPluginSetupFlow } from './plugin-setup-flow.js';

const SPEC: PluginSetupSpec = {
  title: 'T',
  required: true,
  fields: [
    { key: 'token', label: 'Token', kind: 'secret' },
    { key: 'region', label: 'Region', kind: 'select', options: ['eu', 'us'], required: false },
    { key: 'verbose', label: 'Verbose', kind: 'boolean', required: false },
  ],
};

describe('createPluginSetupFlow', () => {
  it('walks fields, accumulates values, finishes with the collected map', () => {
    const onFinish = vi.fn();
    const flow = createPluginSetupFlow(SPEC, onFinish);
    expect(flow.current()?.key).toBe('token');
    flow.submit('sk-1');
    expect(flow.current()?.key).toBe('region');
    flow.submit('eu');
    flow.submit(false);
    expect(onFinish).toHaveBeenCalledWith({ token: 'sk-1', region: 'eu', verbose: false });
    expect(flow.state().done).toBe(true);
  });

  it('refuses to skip a required non-secret field, allows optional skips', () => {
    const spec: PluginSetupSpec = {
      title: 'T',
      fields: [
        { key: 'name', label: 'Name', kind: 'string' },
        { key: 'note', label: 'Note', kind: 'string', required: false },
      ],
    };
    const onFinish = vi.fn();
    const flow = createPluginSetupFlow(spec, onFinish);
    flow.skip();
    expect(flow.state().error).toContain('required');
    flow.submit('moxxy');
    flow.skip();
    expect(onFinish).toHaveBeenCalledWith({ name: 'moxxy' });
  });

  it('empty submit on a required SECRET advances (existing vault value may satisfy)', () => {
    const onFinish = vi.fn();
    const flow = createPluginSetupFlow(SPEC, onFinish);
    flow.submit('');
    expect(flow.state().error).toBeNull();
    expect(flow.current()?.key).toBe('region');
  });

  it('cancel finishes with null exactly once', () => {
    const onFinish = vi.fn();
    const flow = createPluginSetupFlow(SPEC, onFinish);
    flow.cancel();
    flow.cancel();
    flow.submit('late');
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledWith(null);
  });
});
