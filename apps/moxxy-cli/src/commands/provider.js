/**
 * Provider commands: install/list/verify.
 */
import { isInteractive, handleCancel, withSpinner, p } from '../ui.js';

export async function runProvider(client, args) {
  let [action, ...rest] = args;

  // Interactive sub-menu when no action
  if (!action && isInteractive()) {
    action = await p.select({
      message: 'Provider action',
      options: [
        { value: 'list',    label: 'List providers',   hint: 'show available providers' },
        { value: 'install', label: 'Install provider',  hint: 'install a new provider' },
        { value: 'verify',  label: 'Verify provider',   hint: 'check provider health' },
      ],
    });
    handleCancel(action);
  }

  switch (action) {
    case 'list': {
      let result;
      if (isInteractive()) {
        result = await withSpinner('Fetching providers...', () =>
          client.request('/v1/providers', 'GET'), 'Providers loaded.');
        if (Array.isArray(result)) {
          for (const pr of result) {
            p.log.info(`${pr.display_name || pr.id}  (${pr.id})`);
          }
          if (result.length === 0) {
            p.log.warn('No providers found.');
          }
        } else {
          console.log(JSON.stringify(result, null, 2));
        }
      } else {
        result = await client.request('/v1/providers', 'GET');
        console.log(JSON.stringify(result, null, 2));
      }
      return result;
    }

    case 'install': {
      console.error('Provider install not yet implemented.');
      process.exitCode = 1;
      break;
    }

    case 'verify': {
      console.error('Provider verify not yet implemented.');
      process.exitCode = 1;
      break;
    }

    default:
      console.error('Usage: moxxy provider <install|list|verify>');
      process.exitCode = 1;
  }
}
