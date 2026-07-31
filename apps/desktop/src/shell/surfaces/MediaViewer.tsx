import { Icon } from '@moxxy/desktop-ui';

/** Local-only audio/video preview. Never autoplays workspace content. */
export function MediaViewer({
  url,
  path,
  mediaType,
}: {
  readonly url: string;
  readonly path: string;
  readonly mediaType: string;
}): JSX.Element {
  const video = mediaType.startsWith('video/');
  return (
    <div className="media-preview">
      {video ? (
        <video controls preload="metadata" playsInline aria-label={path}>
          <source src={url} type={mediaType} />
        </video>
      ) : (
        <div className="media-preview__audio">
          <span className="media-preview__icon" aria-hidden="true">
            <Icon name="speaker" size={20} />
          </span>
          <div>
            <strong>{path.split(/[\\/]/).pop() ?? path}</strong>
            <small>{mediaType}</small>
          </div>
          <audio controls preload="metadata" aria-label={path}>
            <source src={url} type={mediaType} />
          </audio>
        </div>
      )}
    </div>
  );
}
