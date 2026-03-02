/**
 * Provider commands: install/list/verify.
 */

export async function runProvider(client, args) {
  const [action, ...rest] = args;

  switch (action) {
    case 'list': {
      const result = await client.request('/v1/providers', 'GET');
      console.log(JSON.stringify(result, null, 2));
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
