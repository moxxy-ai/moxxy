/**
 * `<webview>` is an Electron element, not a DOM one, so JSX has to be told it
 * exists. Augmenting `JSX.IntrinsicElements` is the only way to do that, and
 * it requires a namespace — which is why this lives in an ambient declaration
 * file rather than inline in the component.
 *
 * Only the attributes the browser pane actually sets are declared. See
 * `shell/surfaces/BrowserPane.tsx`.
 */
import type { DetailedHTMLProps, HTMLAttributes } from 'react';

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string;
        partition?: string;
        allowpopups?: boolean;
      };
    }
  }
}
