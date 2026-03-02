import * as p from '@clack/prompts';

export function isInteractive() {
  return Boolean(process.stdout.isTTY) && !process.env.CI;
}

export function handleCancel(value) {
  if (p.isCancel(value)) {
    p.cancel('Operation cancelled.');
    process.exit(0);
  }
  return value;
}

export async function withSpinner(startMsg, fn, stopMsg) {
  const s = p.spinner();
  s.start(startMsg);
  try {
    const result = await fn();
    s.stop(stopMsg || 'Done.');
    return result;
  } catch (err) {
    s.stop(`Failed: ${err.message}`);
    throw err;
  }
}

export async function pickAgent(client, message = 'Select an agent') {
  const agents = await withSpinner('Fetching agents...', () => client.listAgents(), 'Agents loaded.');
  if (!agents || agents.length === 0) {
    p.log.warn('No agents found. Create one first with: moxxy agent create');
    process.exit(1);
  }
  const selected = await p.select({
    message,
    options: agents.map(a => ({
      value: a.id,
      label: a.name || a.id.slice(0, 12),
      hint: `${a.provider_id}/${a.model_id} [${a.status}]`,
    })),
  });
  return handleCancel(selected);
}

export async function pickProvider(client) {
  const providers = await withSpinner('Fetching providers...', () => client.listProviders(), 'Providers loaded.');
  if (!providers || providers.length === 0) {
    p.log.warn('No providers available. Install one first.');
    process.exit(1);
  }
  const selected = await p.select({
    message: 'Select a provider',
    options: providers.map(pr => ({
      value: pr.id,
      label: pr.display_name || pr.id,
    })),
  });
  return handleCancel(selected);
}

export async function pickModel(client, providerId) {
  const models = await withSpinner('Fetching models...', () => client.listModels(providerId), 'Models loaded.');
  if (!models || models.length === 0) {
    p.log.warn(`No models available for provider ${providerId}.`);
    process.exit(1);
  }
  const selected = await p.select({
    message: 'Select a model',
    options: models.map(m => ({
      value: m.model_id,
      label: m.display_name || m.model_id,
    })),
  });
  return handleCancel(selected);
}

export async function pickSkill(client, agentId, message = 'Select a skill') {
  const skills = await withSpinner('Fetching skills...', () => client.listSkills(agentId), 'Skills loaded.');
  if (!skills || skills.length === 0) {
    p.log.warn('No skills found for this agent.');
    process.exit(1);
  }
  const statusIcon = (s) => s === 'approved' ? '\u2705' : s === 'quarantined' ? '\u23f3' : '\u274c';
  const selected = await p.select({
    message,
    options: skills.map(s => ({
      value: s.id,
      label: `${statusIcon(s.status)} ${s.name} v${s.version}`,
      hint: `[${s.status}] ${s.id.slice(0, 12)}`,
    })),
  });
  return handleCancel(selected);
}

export function showResult(title, data) {
  const lines = Object.entries(data)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  p.note(lines, title);
}

export { p };
