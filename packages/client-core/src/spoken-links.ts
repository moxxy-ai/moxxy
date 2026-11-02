/**
 * A web address read aloud. Spelled out ("h t t p s colon slash slash…") it
 * means nothing to a listener, so a link is said as a link to its site
 * ("link do strony github") and a bare domain as the site's name ("moxxy").
 */

import type { SpeechLanguage } from '@moxxy/chat-model';

/** Second-level labels of country domains such as bbc.co.uk or onet.com.pl. */
const SECOND_LEVEL_LABELS: ReadonlySet<string> = new Set(['ac', 'co', 'com', 'edu', 'gov', 'net', 'org']);
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//iu;
const DOMAIN_RE = /^(?:www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,}$/iu;

function hostOf(address: string): string {
  return address.replace(SCHEME_RE, '').split(/[/?#]/u)[0]?.replace(/:\d+$/u, '') ?? '';
}

/** The name a site goes by: `github` for github.com/…, `bbc` for www.bbc.co.uk; null for an IP address. */
export function siteName(address: string): string | null {
  const labels = hostOf(address).replace(/^www\./iu, '').split('.').filter(Boolean);
  if (labels.length === 0 || labels.every((label) => /^\d+$/u.test(label))) return null;
  if (labels.length > 1) labels.pop();
  if (labels.length > 1 && SECOND_LEVEL_LABELS.has(labels.at(-1)?.toLowerCase() ?? '')) labels.pop();
  return labels.at(-1) ?? null;
}

/** An address that points somewhere: it has a scheme, or a domain followed by a path or query. */
export function isWebAddress(value: string): boolean {
  if (SCHEME_RE.test(value)) return true;
  const host = hostOf(value);
  return host.length < value.length && DOMAIN_RE.test(host);
}

/** A domain written alone, such as moxxy.ai or www.example.com. */
export function isBareDomain(value: string): boolean {
  return DOMAIN_RE.test(value);
}

/** How a link is said: "link do strony github" in Polish, "a link to github" otherwise. */
export function spokenLink(address: string, language: SpeechLanguage): string {
  const site = siteName(address);
  if (language === 'pl') return site ? `link do strony ${site}` : 'link';
  return site ? `a link to ${site}` : 'a link';
}
