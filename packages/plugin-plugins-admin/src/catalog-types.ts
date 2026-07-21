export interface PluginCatalogEntry {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly packageName: string;
  readonly installSpec: string;
  readonly startCommand?: string;
  readonly defaultPort?: number;
  readonly kind?: 'ui' | 'runtime' | 'cli';
  /**
   * Registry contributions this package provides, so surfaces can offer
   * install-on-first-use when a missing capability is requested.
   */
  readonly provides?: ReadonlyArray<{ readonly category: string; readonly name: string }>;
  /** Provider onboarding metadata, present only for provider packages. */
  readonly provider?: {
    readonly auth: 'key' | 'oauth' | 'none';
    readonly defaultModel?: string;
    readonly recommended?: boolean;
  };
}
