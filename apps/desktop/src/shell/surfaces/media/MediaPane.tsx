import { Icon } from '@moxxy/desktop-ui';
import type { ChatMediaImage } from '@moxxy/desktop-ipc-contract';
import { ImagePreviewModal } from '../../../chat/image-preview/ImagePreviewModal';
import { Segmented } from '../../Segmented';
import { linkHost, linkTitle, mediaDate, type MediaKind } from './media-library';
import { useMediaPane } from './useMediaPane';
import { useMediaTile } from './useMediaTile';
import './media.css';

const SHELVES: ReadonlyArray<{ id: MediaKind; label: string }> = [
  { id: 'image', label: 'Media' },
  { id: 'file', label: 'Files' },
  { id: 'link', label: 'Links' },
];
const OWNERS = [
  { id: 'all', label: 'All' },
  { id: 'me', label: 'You' },
  { id: 'agent', label: 'Agent' },
] as const;
const NAMES = { image: 'images', file: 'files', link: 'links' } as const;

export function MediaPane({ workspaceId }: { readonly workspaceId: string | null }): JSX.Element {
  const state = useMediaPane(workspaceId);
  return (
    <section className="media-pane" aria-label="Chat media">
      <header className="media-pane__header">
        <div className="media-pane__heading">
          <span>Shared in this chat</span>
          <span className="media-pane__count">{state.items.length}</span>
        </div>
        <Segmented items={SHELVES} value={state.kind} onChange={state.setKind} testIdPrefix="media-kind-" />
        <label className="media-pane__search">
          <Icon name="search" size={16} />
          <input
            type="search"
            aria-label="Search chat media"
            placeholder="Search media, files and links"
            value={state.query}
            onChange={(event) => state.setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') state.setQuery('');
            }}
          />
        </label>
        <div className="media-pane__owners" role="radiogroup" aria-label="Shared by">
          {OWNERS.map((owner) => (
            <label key={owner.id} data-active={state.owner === owner.id}>
              <input
                type="radio"
                name={`media-owner-${workspaceId}`}
                value={owner.id}
                checked={state.owner === owner.id}
                onChange={() => state.setOwner(owner.id)}
              />
              {owner.label}
            </label>
          ))}
        </div>
      </header>
      {state.notice && (
        <p className="media-pane__notice" role="status">
          {state.notice}
        </p>
      )}
      <div className="media-pane__body" aria-busy={state.loading}>
        {state.loading ? (
          <p className="media-pane__empty" role="status">
            Reading this chat’s library…
          </p>
        ) : state.error ? (
          <p className="media-pane__empty" role="alert">
            {state.error}
          </p>
        ) : state.empty ? (
          <div className="media-pane__empty">
            <Icon name="image" size={28} />
            <h3>Nothing shared in this chat yet</h3>
            <p>Images, files and links from your messages will collect here.</p>
          </div>
        ) : state.items.length === 0 ? (
          <p className="media-pane__empty">
            {state.query.trim()
              ? `No ${NAMES[state.kind]} match “${state.query}”.`
              : `No ${NAMES[state.kind]} shared here yet.`}
          </p>
        ) : (
          state.groups.map((group) => (
            <section className="media-pane__month" key={group.key}>
              <h3>{group.label}</h3>
              <ul
                aria-label={group.label}
                className={state.kind === 'image' ? 'media-pane__grid' : 'media-pane__rows'}
              >
                {group.items.map((item) => (
                  <li key={item.id}>
                    {item.kind === 'image' ? (
                      <ImageTile workspaceId={workspaceId} item={item} onOpen={state.openImage} />
                    ) : item.kind === 'file' ? (
                      <button
                        type="button"
                        className="media-pane__row"
                        disabled={item.path !== null && item.bytes === null}
                        onClick={() => void state.openFile(item.id)}
                        title={item.name}
                      >
                        <span className="media-pane__file-icon">
                          <Icon name="file" size={19} />
                        </span>
                        <span className="media-pane__row-copy">
                          <strong>{item.name}</strong>
                          <small>
                            {item.bytes === null ? 'Not on this computer' : fileSize(item.bytes)} ·{' '}
                            {mediaDate(item.ts, new Date())}
                          </small>
                        </span>
                      </button>
                    ) : (
                      <a
                        className="media-pane__row"
                        href={item.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        title={item.url}
                      >
                        <span className="media-pane__file-icon">
                          <Icon name="link" size={19} />
                        </span>
                        <span className="media-pane__row-copy">
                          <strong>{linkTitle(item)}</strong>
                          <small>
                            {linkHost(item.url)} · {mediaDate(item.ts, new Date())}
                          </small>
                        </span>
                        <Icon name="chevron-right" size={14} />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
      {state.preview && (
        <>
          {!state.preview.image && (
            <div className="media-pane__preview-loading" role="status">
              Opening image…
              <button type="button" onClick={state.preview.close}>
                Cancel
              </button>
            </div>
          )}
          <ImagePreviewModal
            image={state.preview.image}
            onClose={state.preview.close}
            position={state.preview.position}
            onPrevious={state.preview.hasPrevious ? state.preview.previous : undefined}
            onNext={state.preview.hasNext ? state.preview.next : undefined}
          />
        </>
      )}
    </section>
  );
}

function ImageTile({
  workspaceId,
  item,
  onOpen,
}: {
  readonly workspaceId: string | null;
  readonly item: ChatMediaImage;
  readonly onOpen: (id: string) => void;
}): JSX.Element {
  const { ref, src } = useMediaTile(workspaceId, item.id);
  return (
    <button
      ref={ref}
      type="button"
      className="media-pane__tile"
      onClick={() => onOpen(item.id)}
      title={item.name ?? item.caption}
      aria-label={(item.name ?? item.caption) || 'Image'}
    >
      {src ? <img src={src} alt={item.name ?? 'Image'} /> : <Icon name="image" size={22} />}
      {item.owner === 'agent' && (
        <span className="media-pane__agent" aria-label="From the agent">
          <Icon name="spark" size={12} />
        </span>
      )}
    </button>
  );
}

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
