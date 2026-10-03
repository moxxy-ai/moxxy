import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ModelTuning } from './ModelTuning';
import type { ModelTuning as Tuning } from './useModelTuning';

const tuning = (over: Partial<Tuning> = {}): Tuning => ({
  effort: 'medium', fast: false, canSetEffort: true, canSetFast: true, busy: false, error: null,
  setEffort: vi.fn(async () => {}), setFast: vi.fn(async () => {}), ...over,
});

describe('ModelTuning', () => {
  it('sets the effort and fast mode of the conversation', () => {
    const value = tuning();
    render(<ModelTuning tuning={value} />);
    fireEvent.change(screen.getByLabelText('Reasoning effort'), { target: { value: 'high' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Fast mode' }));
    expect(value.setEffort).toHaveBeenCalledWith('high');
    expect(value.setFast).toHaveBeenCalledWith(true);
  });

  it('turns fast mode off when it is on', () => {
    const value = tuning({ fast: true });
    render(<ModelTuning tuning={value} />);
    expect(screen.getByRole('switch', { name: 'Fast mode' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('switch', { name: 'Fast mode' }));
    expect(value.setFast).toHaveBeenCalledWith(false);
  });

  it('leaves out what the model does not offer', () => {
    render(<ModelTuning tuning={tuning({ canSetFast: false })} />);
    expect(screen.getByLabelText('Reasoning effort')).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Fast mode' })).toBeNull();
  });

  it('renders nothing for a model with neither', () => {
    const { container } = render(<ModelTuning tuning={tuning({ canSetFast: false, canSetEffort: false })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows why a switch failed', () => {
    render(<ModelTuning tuning={tuning({ error: 'Update the CLI' })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Update the CLI');
  });
});
