import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSections } from './useSections';

/** Each view remembers the section it shows; a link from elsewhere changes that one. */

describe('useSections', () => {
  it('starts each view on its first section', () => {
    const { result } = renderHook(() => useSections());

    expect(result.current.settingsTab).toBe('providers');
    expect(result.current.extensionsTab).toBe('mcp');
    expect(result.current.automationsKind).toBe('workflows');
    expect(result.current.channelId).toBeNull();
  });

  it('shows the section a link names, and leaves the other views where they were', () => {
    const { result } = renderHook(() => useSections());

    act(() => result.current.show({ destination: 'settings', section: 'voice' }));
    act(() => result.current.show({ destination: 'extensions', section: 'skills' }));
    act(() => result.current.show({ destination: 'automations', section: 'webhooks' }));
    act(() => result.current.show({ destination: 'channels', section: 'telegram' }));

    expect(result.current).toMatchObject({
      settingsTab: 'voice',
      extensionsTab: 'skills',
      automationsKind: 'webhooks',
      channelId: 'telegram',
    });
  });
});
