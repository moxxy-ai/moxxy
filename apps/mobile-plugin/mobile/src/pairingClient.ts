export type PairingClientResult =
  | { readonly ok: true; readonly token: string; readonly code: string }
  | { readonly ok: false; readonly error: string };

interface PairingClientOptions {
  readonly refreshOnInvalid: boolean;
}

export async function pairWithGatewayCode(
  gatewayUrl: string,
  code: string,
  options: PairingClientOptions,
): Promise<PairingClientResult> {
  const first = await postPairingCode(gatewayUrl, code);
  if (first.ok) return { ok: true, token: first.token, code };
  if (!options.refreshOnInvalid) return { ok: false, error: 'Invalid pairing code' };

  const currentCode = await fetchCurrentPairingCode(gatewayUrl);
  if (!currentCode || currentCode === code) return { ok: false, error: 'Invalid pairing code' };

  const second = await postPairingCode(gatewayUrl, currentCode);
  if (second.ok) return { ok: true, token: second.token, code: currentCode };
  return { ok: false, error: 'Invalid pairing code' };
}

async function postPairingCode(
  gatewayUrl: string,
  code: string,
): Promise<{ readonly ok: true; readonly token: string } | { readonly ok: false }> {
  const res = await fetch(`${gatewayUrl}/mobile/v1/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) return { ok: false };
  const body = (await res.json()) as { token?: unknown };
  return typeof body.token === 'string' ? { ok: true, token: body.token } : { ok: false };
}

async function fetchCurrentPairingCode(gatewayUrl: string): Promise<string | null> {
  const res = await fetch(`${gatewayUrl}/mobile/v1/pairing`);
  if (!res.ok) return null;
  const body = (await res.json()) as { code?: unknown };
  return typeof body.code === 'string' && body.code.length > 0 ? body.code : null;
}
