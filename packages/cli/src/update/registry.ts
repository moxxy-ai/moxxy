import { fetchNpmLatest, type FetchNpmLatestOptions } from '@moxxy/sdk/server';

/** Options for {@link fetchLatest}; the registry call itself lives in `@moxxy/sdk/server`. */
export type FetchLatestOpts = FetchNpmLatestOptions;

/** The version under the `latest` dist-tag for `pkg` (default `@moxxy/cli`), or `null`. */
export function fetchLatest(pkg = '@moxxy/cli', opts: FetchLatestOpts = {}): Promise<string | null> {
  return fetchNpmLatest(pkg, opts);
}
