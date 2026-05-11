import { definePlugin, type Plugin } from '@moxxy/sdk';

export { InteractiveSession, type InteractiveSessionProps } from './InteractiveSession.js';
export { PermissionDialog, type PermissionDialogProps } from './components/PermissionDialog.js';
export { ChatView, type ChatViewProps } from './components/ChatView.js';
export { PromptInput, type PromptInputProps } from './components/PromptInput.js';
export {
  createInteractivePermissionResolver,
  type InteractivePermissionResolverOptions,
  type PermissionPromptHandler,
} from './resolver.js';
export { TuiChannel, type TuiStartOpts } from './TuiChannel.js';

/**
 * The plugin export is mostly metadata — the real surface of this package is
 * the React/Ink components and the `createInteractivePermissionResolver` helper,
 * which the moxxy CLI binary mounts when entering TUI mode.
 */
export const cliPlugin: Plugin = definePlugin({
  name: '@moxxy/plugin-cli',
  version: '0.0.0',
});

export default cliPlugin;
