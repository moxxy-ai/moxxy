import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { __clearChatMediaThumbnails, __setApiOverride } from '@moxxy/client-core';
import type { ChatMediaItem, MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { MediaPane } from './MediaPane';

const PNG_1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const OCT = new Date(`${new Date().getFullYear()}-10-10T10:00:00`).getTime();

const ITEMS: ChatMediaItem[] = [
  {
    kind: 'image',
    id: 't:9:0',
    owner: 'agent',
    seq: 9,
    ts: OCT,
    caption: 'browser_capture cart',
    mediaType: 'image/png',
    name: null,
    bytes: 70,
  },
  {
    kind: 'image',
    id: 'a:2:0',
    owner: 'me',
    seq: 2,
    ts: OCT,
    caption: 'my poster',
    mediaType: 'image/png',
    name: 'poster.png',
    bytes: 70,
  },
  {
    kind: 'link',
    id: 'l:https://tickets.example/visual',
    owner: 'agent',
    seq: 8,
    ts: OCT,
    caption: '',
    url: 'https://tickets.example/visual',
    label: 'Visual Concert tickets',
  },
  {
    kind: 'file',
    id: 'a:2:1',
    owner: 'me',
    seq: 2,
    ts: OCT,
    caption: '',
    name: 'Umowa powierzenia.pdf',
    mediaType: 'application/pdf',
    bytes: 5_536_000,
    path: null,
  },
  {
    kind: 'file',
    id: 'f:/gone.md',
    owner: 'agent',
    seq: 7,
    ts: OCT,
    caption: '',
    name: 'gone.md',
    mediaType: null,
    bytes: null,
    path: '/gone.md',
  },
];

function host(items: ReadonlyArray<ChatMediaItem> = ITEMS) {
  const invoke = vi.fn(async (command: string, args: { id?: string; offset?: number }) => {
    switch (command) {
      case 'chat.media':
        return { items };
      case 'chat.mediaThumbnail':
        return { mediaType: 'image/png', base64: PNG_1x1 };
      case 'chat.readMediaImage':
        return { mediaType: 'image/png', data: PNG_1x1, total: PNG_1x1.length };
      case 'chat.openMediaFile':
        return { opened: 'app' };
      default:
        throw new Error(`unexpected ${command} ${JSON.stringify(args)}`);
    }
  });
  __setApiOverride({
    invoke: invoke as unknown as MoxxyApi['invoke'],
    subscribe: (() => () => undefined) as MoxxyApi['subscribe'],
  });
  return invoke;
}

afterEach(() => {
  __setApiOverride(null);
  __clearChatMediaThumbnails();
});

describe('MediaPane', () => {
  it("opens on the chat's images under their month, each drawn from its thumbnail", async () => {
    host();
    render(<MediaPane workspaceId="w1" />);
    const grid = await screen.findByRole('list', { name: 'October' });
    const tiles = within(grid).getAllByRole('button');
    expect(tiles).toHaveLength(2);
    await waitFor(() =>
      expect(within(tiles[1] as HTMLElement).getByRole('img')).toHaveAttribute(
        'src',
        `data:image/png;base64,${PNG_1x1}`,
      ),
    );
    expect(within(tiles[0] as HTMLElement).getByLabelText('From the agent')).toBeInTheDocument();
  });

  it('opens an image in the preview, where it steps to the next', async () => {
    host();
    render(<MediaPane workspaceId="w1" />);
    const grid = await screen.findByRole('list', { name: 'October' });
    fireEvent.click(within(grid).getAllByRole('button')[0] as HTMLElement);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next image' }));
    expect(await screen.findByText('2 of 2')).toBeInTheDocument();
  });

  it("shows only the person's images, or the agent's", async () => {
    host();
    render(<MediaPane workspaceId="w1" />);
    await screen.findByRole('list', { name: 'October' });
    fireEvent.click(screen.getByRole('radio', { name: 'You' }));
    expect(within(screen.getByRole('list', { name: 'October' })).getAllByRole('button')).toHaveLength(1);
  });

  it('lists files with their size, opens one through the host, and marks one no longer on the disk', async () => {
    const invoke = host();
    render(<MediaPane workspaceId="w1" />);
    fireEvent.click(await screen.findByTestId('media-kind-file'));
    const contract = await screen.findByRole('button', { name: /Umowa powierzenia\.pdf/ });
    expect(contract).toHaveTextContent('5.3 MB');
    fireEvent.click(contract);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('chat.openMediaFile', { workspaceId: 'w1', id: 'a:2:1' }),
    );
    expect(screen.getByRole('button', { name: /gone\.md/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /gone\.md/ })).toHaveTextContent('Not on this computer');
  });

  it('lists links that open the way a link in the chat does', async () => {
    host();
    render(<MediaPane workspaceId="w1" />);
    fireEvent.click(await screen.findByTestId('media-kind-link'));
    const ticket = await screen.findByRole('link', { name: /Visual Concert tickets/ });
    expect(ticket).toHaveAttribute('href', 'https://tickets.example/visual');
    expect(ticket).toHaveAttribute('target', '_blank');
    expect(ticket).toHaveAttribute('rel', 'noreferrer noopener');
    expect(ticket).toHaveTextContent('tickets.example');
  });

  it('finds by words, and says when nothing matches', async () => {
    host();
    render(<MediaPane workspaceId="w1" />);
    await screen.findByRole('list', { name: 'October' });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'poster' } });
    expect(within(screen.getByRole('list', { name: 'October' })).getAllByRole('button')).toHaveLength(1);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'nothing like it' } });
    expect(screen.getByText('No images match “nothing like it”.')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
    expect(screen.getByRole('searchbox')).toHaveValue('');
  });

  it('says what will collect here while the chat has nothing', async () => {
    host([]);
    render(<MediaPane workspaceId="w1" />);
    expect(await screen.findByText('Nothing shared in this chat yet')).toBeInTheDocument();
  });
});
