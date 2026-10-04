import { defineCommand, type CommandDef, type CommandOutput } from '@moxxy/sdk';
import { closeBrowserSidecar } from './browser-session.js';
import { defaultBrowserProfile, signedInSites, signIn, signOut, type BrowserProfile, type SignInOptions } from './profile.js';

/**
 * `/browser` — and `moxxy browser`, which runs it — the terminal browser's
 * sign-ins: open a window to sign in to a site, forget one, list them.
 *
 * The terminal only: the desktop's pane is a browser the person signs in to
 * directly, and a window opened from a chat bot would open on a machine
 * nobody may be sitting at.
 */

export interface BrowserCommandDeps {
  readonly profile?: () => BrowserProfile;
  /** Let go of the profile this process's own browser holds. */
  readonly closeOwnBrowser?: () => Promise<void>;
  readonly signInOptions?: SignInOptions;
}

const USAGE = [
  'Sign-ins of the browser the agent uses in the terminal:',
  '  /browser login <site>    open a window to sign in; the browser keeps the sign-in',
  '  /browser logout <site>   forget the sign-in to a site',
  '  /browser logout --all    forget every sign-in',
  '  /browser sites           list the sites with a saved sign-in',
].join('\n');

const text = (value: string): CommandOutput => ({ kind: 'text', text: value });
const error = (message: string): CommandOutput => ({ kind: 'error', message });

export function buildBrowserCommand(deps: BrowserCommandDeps = {}): CommandDef {
  const profile = deps.profile ?? defaultBrowserProfile;
  const closeOwn = deps.closeOwnBrowser ?? closeBrowserSidecar;

  const run = async (action: string, target: string | undefined): Promise<CommandOutput> => {
    switch (action) {
      case 'login': {
        if (!target) return error('name the site to sign in to, e.g. /browser login canva.com');
        await closeOwn();
        await signIn(profile(), target, deps.signInOptions);
        return text(`Kept what ${target} stored while you signed in. The agent's browser in the terminal starts signed in to it.`);
      }
      case 'logout': {
        if (!target) return error('name the site to forget, or --all to forget every sign-in');
        await closeOwn();
        if (target === '--all') {
          await signOut(profile());
          return text("Forgot every sign-in: the agent's browser in the terminal starts signed out.");
        }
        const { forgot } = await signOut(profile(), target);
        return text(
          forgot.length > 0
            ? `Forgot the sign-in to ${target} (${forgot.join(', ')}).`
            : `There was no sign-in saved for ${target}; its stored data is cleared all the same.`,
        );
      }
      case 'sites': {
        await closeOwn();
        const sites = await signedInSites(profile());
        return text(sites.length > 0 ? `Saved sign-ins:\n${sites.map((s) => `  ${s}`).join('\n')}` : 'There are no saved sign-ins.');
      }
      default:
        return error(`unknown action "${action}"\n${USAGE}`);
    }
  };

  return defineCommand({
    name: 'browser',
    description: "Sign the terminal's browser in to a site, forget a sign-in, or list them",
    argumentHint: 'login <site> | logout <site>|--all | sites',
    channels: ['tui'],
    pendingNotice: 'Working on the browser sign-ins — to sign in, use the window that opened and close it when done.',
    handler: async ({ args }) => {
      const [action, target] = args.trim().split(/\s+/).filter(Boolean);
      if (!action) return text(USAGE);
      try {
        return await run(action, target);
      } catch (err) {
        return error(err instanceof Error ? err.message : String(err));
      }
    },
  });
}
