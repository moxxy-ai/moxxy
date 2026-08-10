import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FocusMiniVoiceStatus } from './FocusMiniVoiceStatus';

describe('FocusMiniVoiceStatus', () => {
  it('shows only the first-person voice state, without a hardcoded text-mode label', () => {
    render(<FocusMiniVoiceStatus phase="thinking" />);

    expect(screen.getByText("I'm thinking")).toBeTruthy();
    expect(screen.queryByText(/^text$/i)).toBeNull();
  });
});
