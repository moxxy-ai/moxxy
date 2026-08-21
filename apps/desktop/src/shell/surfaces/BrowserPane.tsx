import { useRef, useState } from 'react';
import { Button, Icon } from '@moxxy/desktop-ui';
import type { BrowserTabInfo } from '@moxxy/desktop-ipc-contract';
import { BROWSER_PARTITION_NAME, HOME_URL, useBrowserTabs } from './useBrowserTabs';
import { useBrowserChrome } from './useBrowserChrome';
import { useAdoptedWebview, type WebviewElement } from './useAdoptedWebview';

/**
 * The agent's browser.
 *
 * The page is a real Chromium view this window composites — not a picture of
 * one. The pane used to receive a JPEG of the viewport several times a second
 * and paint it into an `<img>`; that pipeline is gone, and with it the cost
 * that made the panel expensive to leave open. What is left is chrome: a tab
 * strip, an address bar, and the views themselves.
 *
 * Every tab stays mounted and only the active one is shown. Unmounting an
 * inactive tab would destroy its page — losing scroll position, form state and
 * whatever the agent had set up there — which is precisely what a tab is
 * supposed to survive. Closing one therefore *is* unmounting it.
 *
 * Presentational by construction: the tab set lives in {@link useBrowserTabs},
 * the address bar and the screenshot hand-off in {@link useBrowserChrome}, and the
 * hand-off from renderer to main in {@link useAdoptedWebview}.
 */

/** One tab's view. Owns its adoption handshake and renders nothing else. */
function TabView({
  initialUrl,
  requestId,
  visible,
  adopt,
  release,
  registerView,
  onState,
}: {
  readonly initialUrl: string;
  readonly requestId?: string;
  readonly visible: boolean;
  readonly adopt: (webContentsId: number, requestId?: string) => Promise<string | null>;
  readonly release: (tabId: string) => Promise<void>;
  readonly registerView: (tabId: string, focus: (() => void) | null) => void;
  readonly onState: (tabId: string | null, url: string) => void;
}): JSX.Element {
  const ref = useRef<WebviewElement | null>(null);
  const { tabId, url } = useAdoptedWebview({
    ref,
    adopt,
    release,
    registerView,
    ...(requestId ? { requestId } : {}),
  });

  // Let the chrome above act on whichever view is in front.
  if (visible) onState(tabId, url || initialUrl);

  return (
    <webview
      ref={ref as unknown as React.Ref<HTMLElement>}
      src={initialUrl}
      partition={BROWSER_PARTITION_NAME}
      allowpopups
      style={{
        // Laid out but hidden rather than `display:none`: a background tab must
        // stay a live page, and Chromium stops painting an undisplayed view.
        position: 'absolute',
        inset: 0,
        visibility: visible ? 'visible' : 'hidden',
        zIndex: visible ? 1 : 0,
      }}
    />
  );
}

/** Tracks one pane's adopted id so visibility can be decided from it. */
function TabSlot({
  pane,
  index,
  activeTabId,
  adopt,
  release,
  registerView,
  onState,
}: {
  readonly pane: { key: string; initialUrl: string; requestId?: string };
  readonly index: number;
  readonly activeTabId: string | null;
  readonly adopt: (webContentsId: number, requestId?: string) => Promise<string | null>;
  readonly release: (tabId: string) => Promise<void>;
  readonly registerView: (tabId: string, focus: (() => void) | null) => void;
  readonly onState: (tabId: string | null, url: string) => void;
}): JSX.Element {
  const [tabId, setTabId] = useState<string | null>(null);
  // Before anything is adopted the first pane is the one in front.
  const visible = activeTabId ? tabId === activeTabId : index === 0;

  return (
    <TabView
      initialUrl={pane.initialUrl}
      {...(pane.requestId ? { requestId: pane.requestId } : {})}
      visible={visible}
      adopt={async (wcId, reqId) => {
        const id = await adopt(wcId, reqId);
        setTabId(id);
        return id;
      }}
      release={release}
      registerView={registerView}
      onState={onState}
    />
  );
}

/** The strip. One cell per tab, plus the way to make another. */
function TabStrip({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onNew,
}: {
  readonly tabs: ReadonlyArray<BrowserTabInfo>;
  readonly activeTabId: string | null;
  readonly onSelect: (tabId: string) => void;
  readonly onClose: (tabId: string) => void;
  readonly onNew: () => void;
}): JSX.Element {
  return (
    <div className="browser__tabs">
      <div className="browser__tablist" role="tablist" aria-label="Browser tabs">
        {tabs.map((tab) => {
          const name = tab.title || tab.url || tab.tabId;
          return (
            // The cell is presentational so the tab and its close button can be
            // siblings: a button inside a button is not markup a browser accepts.
            <div key={tab.tabId} className="browser__tab" data-active={tab.tabId === activeTabId} role="presentation">
              <button
                type="button"
                role="tab"
                aria-selected={tab.tabId === activeTabId}
                className="browser__tab-name"
                title={tab.url}
                onClick={() => onSelect(tab.tabId)}
              >
                <Icon name="globe" size={11} />
                <span>{name}</span>
              </button>
              <button
                type="button"
                className="browser__tab-x"
                aria-label={`Close ${name}`}
                onClick={() => onClose(tab.tabId)}
              >
                <Icon name="x" size={10} />
              </button>
            </div>
          );
        })}
      </div>
      {/* Outside the tablist: a tablist holds tabs, and this is not one. */}
      <button
        type="button"
        className="btn-quiet browser__tab-new tip"
        data-tip="New tab"
        data-tip-side="bottom"
        aria-label="New tab"
        onClick={onNew}
      >
        <Icon name="plus" size={13} />
      </button>
    </div>
  );
}

export function BrowserPane({ workspaceId }: { readonly workspaceId: string | null }): JSX.Element {
  const {
    tabs, activeTabId, error, adopt, release, select, navigate,
    panes, openPane, closeTab, history, handoff, answerHandoff, noteAdoption, registerView,
  } = useBrowserTabs();
  const chrome = useBrowserChrome({ activeTabId, navigate });

  if (!workspaceId) {
    return <div className="browser__empty">Open a workspace to use the browser.</div>;
  }

  return (
    <div className="browser">
      <TabStrip
        tabs={tabs}
        activeTabId={activeTabId}
        onSelect={(tabId) => void select(tabId)}
        onClose={(tabId) => void closeTab(tabId)}
        onNew={() => openPane(HOME_URL)}
      />

      <div className="browser__bar">
        <button
          type="button"
          className="btn-quiet"
          aria-label="Back"
          onClick={() => void history('back', chrome.targetTab())}
        >
          <Icon name="chevron-right" size={14} style={{ transform: 'rotate(180deg)' }} />
        </button>
        <button
          type="button"
          className="btn-quiet"
          aria-label="Forward"
          onClick={() => void history('forward', chrome.targetTab())}
        >
          <Icon name="chevron-right" size={14} />
        </button>
        <button
          type="button"
          className="btn-quiet"
          aria-label="Reload"
          onClick={() => void history('reload', chrome.targetTab())}
        >
          <Icon name="rotate" size={13} />
        </button>
        <input
          aria-label="Address"
          className="browser__address"
          value={chrome.address}
          placeholder={HOME_URL}
          onChange={(e) => chrome.setAddress(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') chrome.submitAddress();
          }}
          onBlur={() => chrome.editing && chrome.submitAddress()}
          spellCheck={false}
        />
        <button
          type="button"
          className="btn-quiet tip"
          data-tip="Screenshot to agent"
          data-tip-side="left"
          aria-label="Screenshot to agent"
          onClick={() => void chrome.captureToAgent()}
        >
          <Icon name="attach" size={14} />
        </button>
      </div>

      {handoff && (
        <div className="browser__notice" role="alert">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <strong className="browser__notice-title">Moxxy needs you</strong>
            <span className="browser__notice-body">{handoff.reason}</span>
            {handoff.label && (
              <span className="browser__notice-body">
                Look for: <strong>{handoff.label}</strong>
              </span>
            )}
            <span className="browser__notice-body">
              {handoff.onScreen
                ? 'The agent is not reading the page right now — do what it asks, then press Done.'
                : 'It is on this page but not in view — scroll to find it. The agent is not reading the page right now; press Done when you have.'}
            </span>
          </div>
          <div className="browser__notice-actions">
            <Button size="sm" onClick={() => void answerHandoff(true)}>Done</Button>
            <Button size="sm" variant="ghost" onClick={() => void answerHandoff(false)}>Skip</Button>
          </div>
        </div>
      )}

      {(error || chrome.captureError) && <div className="browser__error">{error ?? chrome.captureError}</div>}

      <div className="browser__viewport">
        {panes.map((pane, index) => (
          <TabSlot
            key={pane.key}
            pane={pane}
            index={index}
            activeTabId={activeTabId}
            adopt={async (wcId, reqId) => {
              const id = await adopt(wcId, reqId);
              if (id) noteAdoption(pane.key, id);
              return id;
            }}
            release={release}
            registerView={registerView}
            onState={chrome.onViewState}
          />
        ))}
      </div>

    </div>
  );
}
