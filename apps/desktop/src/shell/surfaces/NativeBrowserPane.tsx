import { Icon } from '@moxxy/desktop-ui';

import { useReducedMotion } from '../useReducedMotion';
import { useNativeBrowser, type NativeBrowserViewModel } from './useNativeBrowser';
import './native-browser-pane.css';

export function NativeBrowserPane({ workspaceId }: { readonly workspaceId: string }): JSX.Element {
  const model = useNativeBrowser(workspaceId);
  const reducedMotion = useReducedMotion();
  return <NativeBrowserPaneView model={model} reducedMotion={reducedMotion} />;
}

/** Presentation-only surface. All state transitions, IPC, attachment writes,
 * geometry and capture orchestration live in useNativeBrowser. */
export function NativeBrowserPaneView({
  model,
  reducedMotion,
}: {
  readonly model: NativeBrowserViewModel;
  readonly reducedMotion: boolean;
}): JSX.Element {
  const { snapshot, activeTab } = model;
  const captureActive = Boolean(model.captureImage);
  const permissionRequest = snapshot?.permissionRequest;

  return (
    <div className="native-browser">
      <div className="native-browser__tabs" role="tablist" aria-label="Browser tabs">
        <div className="native-browser__tab-scroll">
          {snapshot?.tabs.map((tab) => (
            <div
              key={tab.id}
              role="tab"
              aria-selected={tab.id === snapshot.activeTabId}
              aria-label={tab.title || 'New tab'}
              tabIndex={tab.id === snapshot.activeTabId ? 0 : -1}
              className="native-browser__tab"
              data-active={tab.id === snapshot.activeTabId}
              onClick={() => model.selectTab(tab.id)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                model.selectTab(tab.id);
              }}
            >
              <span className="native-browser__favicon" aria-hidden>
                {tab.loading ? (
                  <Spinner reduced={reducedMotion} size={12} />
                ) : (
                  <Icon name="globe" size={12} />
                )}
              </span>
              <span className="native-browser__tab-title" title={tab.title || tab.url}>
                {tab.title || 'New tab'}
              </span>
              <button
                type="button"
                className="native-browser__tab-close"
                aria-label={`Close ${tab.title || 'tab'}`}
                title="Close tab"
                disabled={captureActive}
                onClick={(event) => {
                  event.stopPropagation();
                  model.closeTab(tab.id);
                }}
              >
                <Icon name="x" size={11} />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="native-browser__icon-button native-browser__new-tab"
          aria-label="New tab"
          title="New tab"
          disabled={captureActive}
          onClick={model.newTab}
        >
          <Icon name="plus" size={14} />
        </button>
      </div>

      <div className="native-browser__toolbar">
        <button
          type="button"
          className="native-browser__icon-button"
          aria-label="Back"
          title="Back"
          disabled={!activeTab?.canGoBack || captureActive}
          onClick={model.goBack}
        >
          <Icon name="chevron-right" size={14} className="native-browser__back-icon" />
        </button>
        <button
          type="button"
          className="native-browser__icon-button"
          aria-label="Forward"
          title="Forward"
          disabled={!activeTab?.canGoForward || captureActive}
          onClick={model.goForward}
        >
          <Icon name="chevron-right" size={14} />
        </button>
        <button
          type="button"
          className="native-browser__icon-button"
          aria-label="Reload"
          title="Reload"
          disabled={!activeTab || captureActive}
          onClick={model.reload}
        >
          <Icon name="rotate" size={14} />
        </button>

        <form
          className="native-browser__address-form"
          onSubmit={(event) => {
            event.preventDefault();
            model.navigate();
          }}
        >
          <Icon name="globe" size={13} className="native-browser__address-icon" />
          <input
            aria-label="Address"
            type="text"
            value={model.address}
            placeholder="Search or enter a URL"
            spellCheck={false}
            disabled={!activeTab || captureActive}
            onFocus={model.beginAddressEdit}
            onBlur={model.endAddressEdit}
            onChange={(event) => model.setAddress(event.target.value)}
          />
        </form>

        <div className="native-browser__zoom" aria-label="Page zoom">
          <button
            type="button"
            aria-label="Zoom out"
            title="Zoom out"
            disabled={!activeTab || captureActive}
            onClick={() => model.setZoom((activeTab?.zoom ?? 1) - 0.1)}
          >
            −
          </button>
          <button
            type="button"
            className="native-browser__zoom-value"
            title="Reset zoom"
            disabled={!activeTab || captureActive}
            onClick={() => model.setZoom(1)}
          >
            {Math.round((activeTab?.zoom ?? 1) * 100)}%
          </button>
          <button
            type="button"
            aria-label="Zoom in"
            title="Zoom in"
            disabled={!activeTab || captureActive}
            onClick={() => model.setZoom((activeTab?.zoom ?? 1) + 0.1)}
          >
            +
          </button>
        </div>

        <button
          type="button"
          className="native-browser__icon-button"
          data-active={captureActive}
          aria-label={captureActive ? 'Cancel capture' : 'Capture region'}
          title={captureActive ? 'Cancel capture' : 'Capture a region for the agent'}
          disabled={!activeTab}
          onClick={captureActive ? model.cancelCapture : model.startCapture}
        >
          <Icon name={captureActive ? 'x' : 'attach'} size={14} />
        </button>
      </div>

      {(model.error || model.notice || captureActive) && (
        <div
          className="native-browser__message"
          data-error={Boolean(model.error)}
          role={model.error ? 'alert' : 'status'}
        >
          <span>
            {model.error ??
              model.notice ??
              'Drag over the page to capture a region for the agent. Press Escape to cancel.'}
          </span>
          {model.error && (
            <button type="button" onClick={model.retry}>
              Try again
            </button>
          )}
        </div>
      )}

      {permissionRequest && (
        <div className="native-browser__permission" role="alert">
          <span>
            <strong>{permissionRequest.origin}</strong> wants to use{' '}
            {permissionLabel(permissionRequest.permission)}.
          </span>
          <div>
            <button
              type="button"
              onClick={() => model.resolvePermission(permissionRequest.id, false)}
            >
              Block
            </button>
            <button
              type="button"
              data-primary="true"
              onClick={() => model.resolvePermission(permissionRequest.id, true)}
            >
              Allow for this session
            </button>
          </div>
        </div>
      )}

      {snapshot?.downloads?.map((download) => (
        <div className="native-browser__download" role="status" key={download.id}>
          <span>
            <strong>{download.filename}</strong> · {downloadStatus(download)}
          </span>
          {download.state === 'progressing' && (
            <button type="button" onClick={() => model.cancelDownload(download.id)}>
              Cancel
            </button>
          )}
        </div>
      ))}

      {snapshot?.agentControl && (
        <div
          className="native-browser__agent-control"
          role="status"
          aria-label="Agent browser control"
        >
          <span className="native-browser__agent-control-dot" aria-hidden />
          <span>Moxxy is controlling this tab</span>
          <button
            type="button"
            aria-label="Stop agent control"
            onClick={model.stopAgentControl}
          >
            Stop
          </button>
        </div>
      )}

      <div
        ref={model.hostRef}
        className="native-browser__host"
        data-capturing={captureActive}
        onPointerDown={model.onCapturePointerDown}
        onPointerMove={model.onCapturePointerMove}
        onPointerUp={model.onCapturePointerUp}
      >
        {!snapshot && !model.error && (
          <div className="native-browser__loading" role="status">
            <Spinner reduced={reducedMotion} size={22} />
            <span>Starting browser…</span>
          </div>
        )}
        {model.captureImage && (
          <img
            className="native-browser__capture-image"
            src={model.captureImage}
            alt="Browser capture preview"
            draggable={false}
          />
        )}
        {model.drag && (
          <div
            className="native-browser__selection"
            style={{
              left: Math.min(model.drag.x0, model.drag.x1),
              top: Math.min(model.drag.y0, model.drag.y1),
              width: Math.abs(model.drag.x1 - model.drag.x0),
              height: Math.abs(model.drag.y1 - model.drag.y0),
            }}
          />
        )}
      </div>
    </div>
  );
}

function permissionLabel(permission: string): string {
  if (permission === 'microphone-camera') return 'the microphone and camera';
  if (permission === 'microphone') return 'the microphone';
  if (permission === 'camera') return 'the camera';
  if (permission === 'geolocation') return 'your location';
  return 'the clipboard';
}

function downloadStatus(download: {
  readonly state: string;
  readonly receivedBytes: number;
  readonly totalBytes: number;
  readonly savePath: string;
}): string {
  if (download.state === 'completed') return `Saved to ${download.savePath}`;
  if (download.state === 'cancelled') return 'Cancelled';
  if (download.state === 'interrupted') return 'Interrupted';
  if (download.totalBytes <= 0) return 'Downloading…';
  return `${Math.min(100, Math.round((download.receivedBytes / download.totalBytes) * 100))}%`;
}

function Spinner({
  size,
  reduced,
}: {
  readonly size: number;
  readonly reduced: boolean;
}): JSX.Element {
  return (
    <span
      className="native-browser__spinner"
      data-reduced-motion={reduced}
      style={{ width: size, height: size }}
      aria-hidden
    />
  );
}
