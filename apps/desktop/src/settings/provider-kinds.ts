/**
 * The two kinds of provider, by how the person signs in, named the same in
 * Settings → Providers, the model picker and the first-run provider step: an
 * agent app reached through its SDK on an OAuth sign-in, or a model reached
 * through its API with an API key. Just the names: no line explaining them.
 */
export const PROVIDER_KINDS = {
  agents: { title: 'SDK · OAuth login' },
  models: { title: 'API · API key login' },
} as const;
