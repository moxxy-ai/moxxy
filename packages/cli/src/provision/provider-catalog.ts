import { INSTALLABLE_PLUGIN_CATALOG } from '@moxxy/plugin-plugins-admin';

export type ProviderAuthKind = 'key' | 'oauth' | 'none';

export interface ProviderCatalogEntry {
  readonly slug: string;
  readonly label: string;
  readonly description: string;
  readonly packageName: string;
  readonly auth: ProviderAuthKind;
  readonly defaultModel?: string;
  readonly recommended?: boolean;
}

/**
 * Provider catalog projected from the generic plugin catalog. The CLI owns no
 * provider list: provider packages publish their install/onboarding metadata in
 * the catalog consumed by every package-management surface.
 */
export const PROVIDER_CATALOG: ReadonlyArray<ProviderCatalogEntry> =
  INSTALLABLE_PLUGIN_CATALOG.flatMap((entry) => {
    if (!entry.provider) return [];
    return (entry.provides ?? [])
      .filter((provided) => provided.category === 'provider')
      .map((contribution) => ({
        slug: contribution.name,
        label: entry.label,
        description: entry.description,
        packageName: entry.packageName,
        auth: entry.provider!.auth,
        ...(entry.provider!.defaultModel ? { defaultModel: entry.provider!.defaultModel } : {}),
        ...(entry.provider!.recommended ? { recommended: true } : {}),
      }));
  });

export function resolveProvider(slugOrPackage: string): ProviderCatalogEntry | undefined {
  return PROVIDER_CATALOG.find(
    (provider) => provider.slug === slugOrPackage || provider.packageName === slugOrPackage,
  );
}
