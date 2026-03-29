function normalizeQuery(query) {
  return String(query || '').trim().toLowerCase();
}

function inferProviderLabel(provider) {
  return provider.display_name || provider.provider_name || provider.id || provider.provider_id || 'Provider';
}

function inferProviderId(provider) {
  return provider.id || provider.provider_id || '';
}

function inferDeployment(model) {
  if (typeof model.deployment === 'string' && model.deployment.trim()) {
    return model.deployment.trim().toLowerCase();
  }

  const metadataDeployment = model.metadata?.deployment;
  if (typeof metadataDeployment === 'string' && metadataDeployment.trim()) {
    return metadataDeployment.trim().toLowerCase();
  }

  if (model.provider_id === 'ollama') {
    const id = String(model.model_id || '').toLowerCase();
    if (id.includes(':cloud') || id.includes('-cloud')) {
      return 'cloud';
    }
    return 'local';
  }

  return null;
}

function isModelMatch(model, query) {
  if (!query) return true;

  return [
    model.provider_name,
    model.provider_id,
    model.model_name,
    model.model_id,
    model.deployment,
  ]
    .filter(Boolean)
    .some(value => String(value).toLowerCase().includes(query));
}

function isProviderMatch(provider, query) {
  if (!query) return true;

  return [
    provider.provider_name,
    provider.provider_id,
    'custom model',
  ]
    .some(value => String(value).toLowerCase().includes(query));
}

export function buildModelPickerEntries(providers, models, query = '', currentCustom = null) {
  const normalizedQuery = normalizeQuery(query);
  const grouped = new Map();

  for (const provider of providers || []) {
    const providerId = inferProviderId(provider);
    if (!providerId) continue;
    grouped.set(providerId, {
      provider_id: providerId,
      provider_name: inferProviderLabel(provider),
      models: [],
    });
  }

  for (const model of models || []) {
    const providerId = model.provider_id;
    if (!providerId) continue;
    if (!grouped.has(providerId)) {
      grouped.set(providerId, {
        provider_id: providerId,
        provider_name: model.provider_name || providerId,
        models: [],
      });
    }
    grouped.get(providerId).models.push({
      ...model,
      provider_name: model.provider_name || grouped.get(providerId).provider_name,
      deployment: inferDeployment(model),
    });
  }

  const providerGroups = Array.from(grouped.values()).sort((left, right) =>
    left.provider_name.toLowerCase().localeCompare(right.provider_name.toLowerCase())
  );

  const entries = [];
  for (const provider of providerGroups) {
    const visibleModels = provider.models
      .filter(model => isModelMatch(model, normalizedQuery))
      .sort((left, right) => {
        const leftRank = left.deployment === 'local' ? 0 : left.deployment === 'cloud' ? 1 : 2;
        const rightRank = right.deployment === 'local' ? 0 : right.deployment === 'cloud' ? 1 : 2;
        return leftRank - rightRank
          || left.model_name.toLowerCase().localeCompare(right.model_name.toLowerCase());
      });

    const providerMatches = isProviderMatch(provider, normalizedQuery);
    if (visibleModels.length === 0 && !providerMatches) continue;

    const currentCustomModelId = currentCustom?.provider_id === provider.provider_id
      ? currentCustom.model_id
      : null;

    entries.push({
      type: 'section',
      label: provider.provider_name,
      provider_id: provider.provider_id,
    });

    for (const model of visibleModels) {
      entries.push({
        type: 'model',
        ...model,
      });
    }

    entries.push({
      type: 'custom',
      provider_id: provider.provider_id,
      provider_name: provider.provider_name,
      is_current: Boolean(currentCustomModelId),
      current_model_id: currentCustomModelId,
    });
  }

  return entries;
}

function isSelectable(entry) {
  return entry && entry.type !== 'section';
}

export function movePickerSelection(entries, currentIndex, direction) {
  if (!Array.isArray(entries) || entries.length === 0) return 0;

  let index = Number.isInteger(currentIndex) ? currentIndex : 0;
  while (true) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= entries.length) {
      return index;
    }
    index = nextIndex;
    if (isSelectable(entries[index])) {
      return index;
    }
  }
}

export function findFirstSelectableIndex(entries) {
  if (!Array.isArray(entries)) return 0;
  const index = entries.findIndex(isSelectable);
  return index >= 0 ? index : 0;
}

export function clampPickerScroll(selectedIndex, scrollOffset, visibleRows) {
  if (!visibleRows || visibleRows <= 0) return 0;

  const selected = Math.max(0, Number(selectedIndex) || 0);
  const scroll = Math.max(0, Number(scrollOffset) || 0);
  const viewport = Math.max(1, Number(visibleRows) || 1);
  const end = scroll + viewport - 1;

  if (selected < scroll) return selected;
  if (selected > end) return selected - viewport + 1;
  return scroll;
}
