import { createContext, useContext } from 'react';
import type { FileViewMode } from './FileViewer';
import type { RailPane } from './registry';

/**
 * Imperative controls for the embedded panel, exposed to deeply-nested chat
 * blocks (e.g. a Write/Edit artifact card) WITHOUT prop-drilling through the
 * transcript. App provides the real implementation (it owns the rail state);
 * the default is a no-op so blocks render fine outside a provider (tests).
 */
export interface PanelControls {
  /** Open the file pane on `path` (z.ai: click an artifact chip → open the pane). */
  openFile: (path: string, mode: FileViewMode) => void;
  /** Open an arbitrary pane kind. */
  openPane: (kind: RailPane) => void;
}

const noop: PanelControls = { openFile: () => {}, openPane: () => {} };

const PanelControlsContext = createContext<PanelControls>(noop);

export const PanelControlsProvider = PanelControlsContext.Provider;

export function usePanelControls(): PanelControls {
  return useContext(PanelControlsContext);
}
