/**
 * The two kinds of provider, named the same in Settings → Providers, the model
 * picker and the first-run provider step: an agent app reached through its SDK,
 * or a model Moxxy calls through its API. `short` fits the picker's narrow
 * column; `description` is the line under a Settings heading.
 */
export const PROVIDER_KINDS = {
  agents: {
    title: 'SDK agents',
    short: 'An app on this computer does the work',
    description: 'An agent app installed on this computer does the work, on its own sign-in.',
  },
  models: {
    title: 'API models',
    short: 'Moxxy calls the model',
    description: 'Moxxy does the work and calls the model through its API, with an API key or a model on this computer.',
  },
} as const;
