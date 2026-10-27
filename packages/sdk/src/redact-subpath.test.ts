import { describe, expect, it } from 'vitest';

describe('@moxxy/sdk/redact', () => {
  it('offers the shared redactor without loading the SDK barrel into a browser', async () => {
    const { redactSecretText } = await import('@moxxy/sdk/redact');
    const text = redactSecretText('curl -H "Authorization: Bearer private-credential"');
    expect(text).toContain('curl');
    expect(text).not.toContain('private-credential');
  });
});
