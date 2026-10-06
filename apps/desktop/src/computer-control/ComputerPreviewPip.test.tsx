import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ComputerPreviewPip } from './ComputerPreviewPip';

const image = { mediaType: 'image/jpeg' as const, base64: 'abc', width: 640, height: 400 };
const live = { state: 'live' as const, frame: { seq: 1, image } };

it('shows the app picture with its state in words and the agent cursor where it works', () => {
  render(<ComputerPreviewPip view={live} target="TextEdit — Notes.txt" cursor={{ phase: 'executing', x: 0.25, y: 0.5 }} onHide={() => undefined} />);
  expect(screen.getByRole('status')).toHaveTextContent('Live view');
  const picture = screen.getByRole('img', { name: 'Live view of TextEdit — Notes.txt' });
  expect(picture).toHaveAttribute('width', '640');
  expect(picture).toHaveAttribute('height', '400');
  const cursor = screen.getByTestId('computer-preview-cursor');
  expect(cursor).toHaveStyle({ left: '25%', top: '50%' });
  expect(cursor).toHaveAttribute('data-phase', 'executing');
});

it('draws no cursor when the agent shows none, and no picture before the first frame', () => {
  render(<ComputerPreviewPip view={{ state: 'unavailable', reason: 'Screen Recording is not allowed' }} target={null} cursor={null} onHide={() => undefined} />);
  expect(screen.getByRole('status')).toHaveTextContent('No view: Screen Recording is not allowed');
  expect(screen.queryByTestId('computer-preview-cursor')).toBeNull();
  expect(screen.queryByRole('img')).toBeNull();
});

it('lets the user hide it for this conversation or for all', () => {
  const hidden: string[] = [];
  render(<ComputerPreviewPip view={live} target={null} cursor={null} onHide={(scope) => hidden.push(scope)} />);
  fireEvent.click(screen.getByRole('button', { name: 'Hide the live view in this conversation' }));
  fireEvent.click(screen.getByRole('button', { name: 'Hide the live view in all conversations' }));
  expect(hidden).toEqual(['conversation', 'all']);
});

it('hands its canvas to the video painter when the view is a video stream', () => {
  const canvases: Array<HTMLCanvasElement | null> = [];
  const { unmount } = render(<ComputerPreviewPip view={{ state: 'live', video: { width: 640, height: 400 } }} target="TextEdit" cursor={{ phase: 'moving', x: 0.5, y: 0.5 }}
    onHide={() => undefined} videoCanvas={(canvas) => canvases.push(canvas)} />);
  const picture = screen.getByRole('img', { name: 'Live view of TextEdit' });
  expect(picture).toHaveAttribute('width', '640');
  expect(canvases).toEqual([picture]);
  expect(screen.getByTestId('computer-preview-cursor')).toBeInTheDocument();
  unmount();
  expect(canvases.at(-1)).toBeNull();
});
