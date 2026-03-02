import { p, handleCancel, withSpinner, showResult } from '../ui.js';
import { VALID_SCOPES } from './auth.js';

export async function runInit(client, args) {
  p.intro('Welcome to Moxxy');

  // Step 1: Check/configure API URL
  const useDefault = await p.confirm({
    message: `Use gateway at ${client.baseUrl}?`,
    initialValue: true,
  });
  handleCancel(useDefault);

  if (!useDefault) {
    const apiUrl = await p.text({
      message: 'Enter gateway URL',
      placeholder: 'http://localhost:3000',
      validate: (val) => {
        try { new URL(val); } catch { return 'Must be a valid URL'; }
      },
    });
    handleCancel(apiUrl);
    client.baseUrl = apiUrl;
  }

  // Step 2: Check gateway connectivity (use unauthenticated probe — any response means reachable)
  let gatewayReachable = false;
  try {
    await withSpinner('Checking gateway connection...', async () => {
      const resp = await fetch(`${client.baseUrl}/v1/providers`);
      // Any HTTP response (even 401) means the gateway is running
      if (resp) gatewayReachable = true;
    }, 'Gateway is reachable.');
  } catch {
    p.log.warn('Gateway is not reachable. Start it with: cargo run -p moxxy-gateway');
    p.log.info('You can continue setup and connect later.');
  }

  // Step 3: Token bootstrap
  const createToken = await p.confirm({
    message: 'Create an API token?',
    initialValue: true,
  });
  handleCancel(createToken);

  if (createToken) {
    const scopes = await p.multiselect({
      message: 'Select token scopes',
      options: VALID_SCOPES.map(s => ({ value: s, label: s })),
      required: true,
    });
    handleCancel(scopes);

    const ttlInput = await p.text({
      message: 'Token TTL in seconds',
      placeholder: 'leave empty for no expiry',
    });
    handleCancel(ttlInput);
    const ttl = ttlInput ? parseInt(ttlInput, 10) : undefined;

    try {
      const payload = { scopes };
      if (ttl) payload.ttl_seconds = ttl;
      const result = await withSpinner('Creating token...', () =>
        client.request('/v1/auth/tokens', 'POST', payload), 'Token created.');

      showResult('Your API Token', {
        ID: result.id,
        Token: result.token,
        Scopes: scopes.join(', '),
      });

      p.note(`export MOXXY_TOKEN="${result.token}"`, 'Add to your shell profile');
    } catch (err) {
      p.log.error(`Failed to create token: ${err.message}`);
    }
  }

  p.outro('Setup complete. Run moxxy to see available commands.');
}
