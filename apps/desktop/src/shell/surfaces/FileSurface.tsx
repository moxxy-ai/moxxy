import { FileViewer, type FileViewMode } from './FileViewer';
import { FilePreview, isPreviewable } from './FilePreview';

/** Header toggle state for the file pane. */
export type FileSurfaceView = 'code' | 'preview';

/**
 * The `file` embedded window: syntax-highlighted code/diff (FileViewer) with a
 * code↔preview toggle. In `preview` mode an HTML/SVG file renders in a sandboxed
 * iframe (FilePreview); everything else falls back to the code view.
 */
export function FileSurface({
  workspaceId,
  path,
  mode,
  view,
}: {
  readonly workspaceId: string | null;
  readonly path: string | null;
  readonly mode: FileViewMode;
  readonly view: FileSurfaceView;
}): JSX.Element {
  if (view === 'preview' && isPreviewable(path)) {
    return <FilePreview workspaceId={workspaceId} path={path} />;
  }
  return <FileViewer workspaceId={workspaceId} path={path} mode={mode} />;
}
