import type { MoxxyConfig } from '@moxxy/config';

/** The model each provider is set to run when a turn names none (`plugins.provider.items.<name>.model`). */
export function configuredDefaultModels(config: MoxxyConfig): Record<string, string> {
  const items = config.plugins?.provider?.items ?? {};
  return Object.fromEntries(
    Object.entries(items).flatMap(([name, item]) => (item?.model ? [[name, item.model] as const] : [])),
  );
}
