#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPOSITORY = 'moxxy-ai/moxxy';
const DEVELOPMENT_REF = 'refs/heads/development';
const MAX_LIST_BYTES = 64 * 1024 * 1024;
const DEPENDENCY_SECTIONS = [
  ['dependencies', 'runtime'],
  ['optionalDependencies', 'runtime'],
];
const ROOT_DEPENDENCY_SECTIONS = [
  ...DEPENDENCY_SECTIONS,
  ['devDependencies', 'development'],
];

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isRegistryVersion(version) {
  return typeof version === 'string'
    && version.length > 0
    && !/^(?:file|link|portal|workspace):/.test(version);
}

function isNpmPackageName(name) {
  if (typeof name !== 'string' || name.length === 0 || /[:\s]/.test(name)) return false;
  const segments = name.split('/');
  return name.startsWith('@')
    ? segments.length === 2 && segments.every((part) => part.length > 0)
    : segments.length === 1;
}

export function npmPackageUrl(name, version) {
  if (typeof name !== 'string' || name.length === 0 || !isRegistryVersion(version)) {
    throw new Error('a registry package name and version are required');
  }
  const segments = name.startsWith('@') ? name.split('/') : [name];
  if ((name.startsWith('@') && segments.length !== 2) || segments.some((part) => part.length === 0)) {
    throw new Error(`invalid npm package name: ${name}`);
  }
  const encodedName = segments.map((part) => encodeURIComponent(part)).join('/');
  return `pkg:npm/${encodedName}@${encodeURIComponent(version)}`;
}

function mergeNode(nodes, packageUrl, relationship, scope) {
  const current = nodes.get(packageUrl);
  if (!current) {
    const created = {
      package_url: packageUrl,
      relationship,
      scope,
      dependencies: new Set(),
    };
    nodes.set(packageUrl, created);
    return created;
  }
  if (relationship === 'direct') current.relationship = 'direct';
  if (scope === 'runtime') current.scope = 'runtime';
  return current;
}

function visitDependency(nodes, name, candidate, relationship, scope) {
  if (!isRecord(candidate)) return null;
  const version = candidate.version;
  let current = null;
  if (isRegistryVersion(version)) {
    const packageName = isNpmPackageName(candidate.from) ? candidate.from : name;
    const packageUrl = npmPackageUrl(packageName, version);
    current = mergeNode(nodes, packageUrl, relationship, scope);
  }

  for (const [section] of DEPENDENCY_SECTIONS) {
    const children = candidate[section];
    if (!isRecord(children)) continue;
    for (const [childName, child] of Object.entries(children)) {
      const childUrl = visitDependency(nodes, childName, child, 'indirect', scope);
      if (current && childUrl) current.dependencies.add(childUrl);
    }
  }
  return current?.package_url ?? null;
}

export function resolvedDependenciesFromPnpmList(workspaces) {
  if (!Array.isArray(workspaces)) throw new Error('pnpm list output must be an array');
  const nodes = new Map();
  for (const workspace of workspaces) {
    if (!isRecord(workspace)) continue;
    for (const [section, scope] of ROOT_DEPENDENCY_SECTIONS) {
      const dependencies = workspace[section];
      if (!isRecord(dependencies)) continue;
      for (const [name, candidate] of Object.entries(dependencies)) {
        visitDependency(nodes, name, candidate, 'direct', scope);
      }
    }
  }

  const resolved = {};
  for (const packageUrl of [...nodes.keys()].sort()) {
    const node = nodes.get(packageUrl);
    const dependencies = [...node.dependencies]
      .filter((dependency) => nodes.has(dependency))
      .sort();
    resolved[packageUrl] = {
      package_url: node.package_url,
      relationship: node.relationship,
      scope: node.scope,
      ...(dependencies.length === 0 ? {} : { dependencies }),
    };
  }
  return resolved;
}

export function buildDependencySnapshot(workspaces, metadata) {
  const resolved = resolvedDependenciesFromPnpmList(workspaces);
  if (Object.keys(resolved).length === 0) {
    throw new Error('refusing to submit an empty dependency snapshot');
  }
  return {
    version: 0,
    sha: metadata.sha,
    ref: metadata.ref,
    job: {
      correlator: 'moxxy-pnpm-resolved',
      id: metadata.jobId,
      html_url: metadata.jobUrl,
    },
    detector: {
      name: 'moxxy-pnpm-resolved',
      version: '1.0.0',
      url: `https://github.com/${REPOSITORY}/blob/${metadata.sha}/scripts/dependency-snapshot.mjs`,
    },
    scanned: metadata.scanned,
    manifests: {
      'pnpm-lock.yaml': {
        name: 'moxxy pnpm workspace',
        file: { source_location: 'pnpm-lock.yaml' },
        resolved,
      },
    },
  };
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export async function submitDependencySnapshot(snapshot, token, fetchImpl = fetch) {
  const response = await fetchImpl(
    `https://api.github.com/repos/${REPOSITORY}/dependency-graph/snapshots`,
    {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-github-api-version': '2022-11-28',
      },
      body: JSON.stringify(snapshot),
    },
  );
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 2_000);
    throw new Error(`GitHub dependency submission failed (${response.status}): ${detail}`);
  }
  return response.json();
}

async function main() {
  const repository = requiredEnv('GITHUB_REPOSITORY');
  const ref = requiredEnv('GITHUB_REF');
  const sha = requiredEnv('GITHUB_SHA');
  if (repository !== REPOSITORY || ref !== DEVELOPMENT_REF || !/^[0-9a-f]{40}$/i.test(sha)) {
    throw new Error('dependency snapshots may only be submitted for moxxy development commits');
  }

  const raw = execFileSync('pnpm', ['-r', 'list', '--depth', 'Infinity', '--json'], {
    encoding: 'utf8',
    maxBuffer: MAX_LIST_BYTES,
  });
  const workspaces = JSON.parse(raw);
  const runId = requiredEnv('GITHUB_RUN_ID');
  const serverUrl = process.env.GITHUB_SERVER_URL ?? 'https://github.com';
  const snapshot = buildDependencySnapshot(workspaces, {
    sha,
    ref,
    jobId: `${runId}.${process.env.GITHUB_RUN_ATTEMPT ?? '1'}`,
    jobUrl: `${serverUrl}/${repository}/actions/runs/${runId}`,
    scanned: new Date().toISOString(),
  });
  const result = await submitDependencySnapshot(snapshot, requiredEnv('GITHUB_TOKEN'));
  const count = Object.keys(snapshot.manifests['pnpm-lock.yaml'].resolved).length;
  console.log(`Submitted ${count} resolved pnpm dependencies (${result.result ?? 'accepted'}).`);
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (entry === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
