import type { ComponentType } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserBlock } from './UserBlock';

const PNG_A = 'AAAA';
const PNG_B = 'BBBB';

describe('UserBlock image preview', () => {
  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:moxxy-preview'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
  });

  it('opens the clicked historical image attachment', () => {
    const onPreviewImage = vi.fn();
    const Component = UserBlock as ComponentType<Record<string, unknown>>;

    render(
      <Component
        text="see these"
        attachments={[
          { kind: 'image', content: PNG_A, mediaType: 'image/png', name: 'first.png' },
          { kind: 'image', content: PNG_B, mediaType: 'image/png', name: 'second.png' },
        ]}
        onPreviewImage={onPreviewImage}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /preview attached image second\.png/i }));

    expect(onPreviewImage).toHaveBeenCalledWith({
      name: 'second.png',
      mediaType: 'image/png',
      base64: PNG_B,
    });
  });
});
