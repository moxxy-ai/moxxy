#!/usr/bin/env node
/**
 * Publish the public workspace packages, working around npm's tombstone
 * policy.
 *
 * Once a version is unpublished from npm the slot is permanently retired.
 * The version number can never be republished even though `npm view` returns
 * 404 for it. Hitting a tombstone makes `npm publish` fail with
 * "Cannot publish over previously published version", which is exactly the
 * error this project keeps tripping over because the package once shipped at
 * 2.x and was later torn down to 0.x.
 *
 * What this script does:
 *
 *   1. Iterate the non-private workspace packages under `packages/`, in
 *      DEPENDENCY ORDER (topological sort over `workspace:` references
 *      between publishable packages — dependencies publish before their
 *      dependents). Order matters because `pnpm publish` rewrites
 *      `workspace:*` to an EXACT pin on the dependency's local package.json
 *      version at pack time: publishing sdk first means a tombstone bump of
 *      sdk (written to its package.json on disk, step 3) is what a later
 *      cli publish pins against. The old readdir order could ship cli pinned
 *      to an sdk version that then bumped past a tombstone and never existed.
 *   2. Skip a package whose current version is already on npm (visible).
 *      This matches the behaviour of `changesets publish` for unchanged
 *      packages, so it's safe to run on every CI invocation.
 *   3. Run `pnpm publish` for everything else (pnpm rewrites the
 *      `workspace:*` / `catalog:` protocols to real version ranges; plain
 *      `npm publish` ships them verbatim and the tarball becomes
 *      uninstallable). When the registry rejects
 *      the version as tombstoned the script bumps the patch number,
 *      writes the new version to package.json, and tries again. The bump
 *      loop is capped (MAX_BUMP_ATTEMPTS) so a misconfiguration cannot
 *      run away.
 *   4. If a package fails to publish, its dependents are NOT published —
 *      they are reported as `blocked` (and count as failures). Publishing
 *      them anyway would ship exact pins on versions that never landed.
 *   5. After all publishes, verify what actually shipped: for every package
 *      published in this run, fetch its manifest from the registry and check
 *      that every `@moxxy/*` dependency version it pinned EXISTS on npm.
 *      A miss is loud and fatal (exit 1) — it means a broken, installable
 *      package is live and the missing dependency version must be published
 *      immediately.
 *   6. Commit any tombstone-driven bumps back to the repository so the next
 *      release does not have to walk the same dead slots again. Only runs
 *      inside GitHub Actions.
 *   7. Create the `<pkg>@<ver>` git tag for each published package and
 *      emit the `🦋  New tag: <pkg>@<ver>` lines, so `changesets/action`
 *      can push the tags and create GitHub releases. (The stock
 *      `changeset publish` creates these tags; this wrapper replaces it,
 *      so it must create them too — otherwise the action's tag push fails
 *      with "src refspec <tag> does not match any".)
 *
 * Flags:
 *   --dry-run   Print the resolved publish order (with each package's
 *               workspace dependencies) and exit. No registry or git access.
 *   --help      Usage.
 *
 * Exit codes: 0 on full success, 1 if any publish failed, was blocked by a
 * failed dependency, or the post-publish dependency-consistency check found
 * a pin on a version that is not on the registry.
 *
 * The pure helpers (topo sort, pin parsing, consistency check) are exported
 * for the unit tests in `scripts/safe-publish.test.mjs` (run via the root
 * `pnpm test:scripts`); importing this module never publishes — the main
 * routine only runs when the script is invoked directly.
 */

import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(process.cwd());
const PACKAGES_DIR = join(ROOT, 'packages');
const MAX_BUMP_ATTEMPTS = 50;

// Patterns the registry uses when the version slot is permanently retired.
// Keep them broad: npm rephrases the message every few releases.
const TOMBSTONE_PATTERNS = [
  /Cannot publish over previously published version/i,
  /cannot publish over the previously published versions/i,
  /previously published versions: \d/i,
  /EPUBLISHCONFLICT/i,
];

// Visible-conflict patterns: the version exists on the registry right now.
// We treat this as a no-op rather than a failure to mirror the behaviour
// changesets has for unchanged packages.
const ALREADY_PUBLISHED_PATTERNS = [
  /You cannot publish over the previously published versions: \d/i,
  /403 Forbidden.*already published/i,
];

// Dependency fields that ship in the published manifest (devDependencies are
// stripped / not installed by consumers, so they don't constrain order).
const SHIPPED_DEP_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'];

function readPkg(dir) {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
}

function writePkg(dir, pkg) {
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
}

function bumpPatch(version) {
  // Strip any pre-release / build suffix and bump the patch component.
  // Pre-release tagged versions (1.2.3-alpha.4) bump the numeric tail.
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version);
  if (!match) throw new Error(`unsupported semver for auto-bump: ${version}`);
  const [, maj, min, pat] = match;
  return `${maj}.${min}.${Number(pat) + 1}`;
}

function alreadyPublished(name, version) {
  const r = spawnSync('npm', ['view', `${name}@${version}`, 'version'], {
    encoding: 'utf8',
  });
  if (r.status !== 0) return false;
  return r.stdout.trim() === version;
}

function tryPublish(dir) {
  // Publish with `pnpm publish`, NOT `npm publish`. pnpm rewrites the
  // pnpm-only `workspace:*` and `catalog:` protocols in `dependencies` /
  // `peerDependencies` to concrete version ranges in the published
  // package.json (`workspace:*` becomes an EXACT pin on the local workspace
  // dependency's version at pack time — which is why tombstone bumps are
  // written to disk and dependencies publish first). `npm publish` ships
  // those protocols verbatim, producing a tarball that npm itself cannot
  // install (EUNSUPPORTEDPROTOCOL 'Unsupported URL Type "workspace:"').
  //
  // --no-git-checks: this script rewrites package.json in place when walking
  //   past tombstoned versions, which dirties the working tree. pnpm's
  //   default pre-publish git checks would otherwise abort the publish.
  const args = ['publish', '--access', 'public', '--no-git-checks'];
  if (process.env.GITHUB_ACTIONS === 'true') args.push('--provenance');
  const r = spawnSync('pnpm', args, {
    cwd: dir,
    encoding: 'utf8',
    env: process.env,
  });
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function matchesAny(text, patterns) {
  return patterns.some((re) => re.test(text));
}

function listPublishablePackages() {
  if (!existsSync(PACKAGES_DIR)) return [];
  return readdirSync(PACKAGES_DIR)
    .map((name) => join(PACKAGES_DIR, name))
    .filter((dir) => statSync(dir).isDirectory())
    .filter((dir) => existsSync(join(dir, 'package.json')))
    .map((dir) => ({ dir, pkg: readPkg(dir) }))
    .filter(({ pkg }) => !pkg.private && typeof pkg.name === 'string');
}

/**
 * Names of OTHER publishable workspace packages this manifest depends on via
 * the `workspace:` protocol, across every dependency field that ships.
 * (Only `workspace:` refs matter: those are the pins pnpm rewrites from the
 * local tree; a plain semver ref resolves from the registry regardless of
 * publish order.)
 */
export function workspaceDepNames(pkg, publishableNames) {
  const found = new Set();
  for (const field of SHIPPED_DEP_FIELDS) {
    for (const [dep, spec] of Object.entries(pkg[field] ?? {})) {
      if (dep === pkg.name) continue;
      if (!publishableNames.has(dep)) continue;
      if (typeof spec === 'string' && spec.startsWith('workspace:')) found.add(dep);
    }
  }
  return [...found].sort();
}

/**
 * Topologically sort `[{ dir, pkg }]` so every package comes AFTER the
 * publishable workspace dependencies it pins. Deterministic (name-sorted
 * DFS). Throws on a dependency cycle — that's a workspace misconfiguration
 * and publishing in any order would ship a pin that can't be satisfied yet.
 */
export function topoSortPackages(packages) {
  const byName = new Map(packages.map((p) => [p.pkg.name, p]));
  const names = new Set(byName.keys());
  const depsOf = new Map(
    packages.map((p) => [p.pkg.name, workspaceDepNames(p.pkg, names)]),
  );
  const sorted = [];
  const done = new Set();
  const visiting = new Set();
  const visit = (name, chain) => {
    if (done.has(name)) return;
    if (visiting.has(name)) {
      throw new Error(
        `workspace dependency cycle between publishable packages: ${[...chain, name].join(' → ')}`,
      );
    }
    visiting.add(name);
    for (const dep of depsOf.get(name)) visit(dep, [...chain, name]);
    visiting.delete(name);
    done.add(name);
    sorted.push(byName.get(name));
  };
  for (const name of [...names].sort()) visit(name, []);
  return sorted;
}

/**
 * Extract the `@moxxy/*` dependency pins from a SHIPPED manifest's
 * dependency fields. Returns `{ name, spec, version }` per pin, where
 * `version` is the concrete base version parsed out of the spec
 * (`0.7.0` / `^0.7.0` / `~0.7.0` → `0.7.0`) or null when unparseable.
 */
export function moxxyDepPins(manifest) {
  const pins = [];
  for (const field of SHIPPED_DEP_FIELDS) {
    for (const [name, spec] of Object.entries(manifest?.[field] ?? {})) {
      if (!name.startsWith('@moxxy/')) continue;
      const m = /(\d+\.\d+\.\d+(?:-[\w.-]+)?)/.exec(String(spec));
      pins.push({ name, spec: String(spec), version: m ? m[1] : null });
    }
  }
  return pins;
}

/**
 * Post-publish consistency check (pure core — registry access is injected).
 * For each package published in this run, read the manifest that actually
 * shipped and verify every `@moxxy/*` pin points at a version that EXISTS on
 * the registry. Returns a list of problems (empty = consistent).
 *
 * io: {
 *   shippedManifest(name, version) → manifest object | null (unreadable),
 *   versionExists(name, version) → boolean,
 * }
 */
export async function findShippedDepProblems(published, io) {
  const problems = [];
  for (const { name, version } of published) {
    const manifest = await io.shippedManifest(name, version);
    if (manifest == null) {
      problems.push({
        pkg: `${name}@${version}`,
        problem: 'could not read the published manifest from the registry',
      });
      continue;
    }
    for (const pin of moxxyDepPins(manifest)) {
      if (pin.version == null) {
        problems.push({
          pkg: `${name}@${version}`,
          problem: `unparseable dependency spec shipped: ${pin.name}@"${pin.spec}"`,
        });
        continue;
      }
      if (!(await io.versionExists(pin.name, pin.version))) {
        problems.push({
          pkg: `${name}@${version}`,
          problem: `shipped pinned to ${pin.name}@${pin.version} (spec "${pin.spec}") which does NOT exist on the registry`,
        });
      }
    }
  }
  return problems;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** `npm view <name>@<version> --json` with retries (registry propagation lag). */
async function fetchShippedManifest(name, version, { attempts = 3, delayMs = 5000 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    const r = spawnSync('npm', ['view', `${name}@${version}`, '--json'], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) {
      try {
        return JSON.parse(r.stdout);
      } catch {
        /* fall through to retry */
      }
    }
    if (i < attempts - 1) await sleep(delayMs);
  }
  return null;
}

async function versionExistsWithRetry(name, version, { attempts = 3, delayMs = 5000 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    if (alreadyPublished(name, version)) return true;
    if (i < attempts - 1) await sleep(delayMs);
  }
  return false;
}

function announceTag(name, version) {
  // The pattern changesets/action greps for to create GitHub releases.
  console.log(`🦋  New tag:  ${name}@${version}`);
}

function inGitHubActions() {
  return process.env.GITHUB_ACTIONS === 'true';
}

function createGitTag(name, version) {
  // After parsing our `🦋  New tag:` lines, changesets/action runs
  // `git push origin <tag>` to create each GitHub Release. The stock
  // `changeset publish` leaves those tags behind locally; this custom
  // publisher must create them itself, or the push fails with
  // "error: src refspec <tag> does not match any". CI-only: that push
  // only happens inside changesets/action.
  if (!inGitHubActions()) return;
  const tag = `${name}@${version}`;
  const r = spawnSync('git', ['tag', tag], { encoding: 'utf8' });
  if (r.status === 0) return;
  // A pre-existing tag (e.g. a re-run over the same version) is fine —
  // the subsequent push still creates/refreshes the release.
  if (/already exists/i.test(r.stderr ?? '')) return;
  console.warn(`Could not create git tag ${tag}: ${(r.stderr ?? '').trim()}`);
}

function commitBumps(bumps) {
  if (bumps.length === 0) return;
  if (!inGitHubActions()) {
    console.log('\nSkipping git commit of tombstone bumps (not in GitHub Actions).');
    return;
  }
  console.log('\nCommitting tombstone bumps so the next release does not walk them again...');
  try {
    execSync('git config user.name "github-actions[bot]"', { stdio: 'inherit' });
    execSync('git config user.email "41898282+github-actions[bot]@users.noreply.github.com"', {
      stdio: 'inherit',
    });
    for (const b of bumps) {
      execSync(`git add ${JSON.stringify(join(b.dir, 'package.json'))}`, { stdio: 'inherit' });
    }
    const summary = bumps.map((b) => `- ${b.name}: ${b.from} → ${b.to}`).join('\n');
    const body = `chore(release): bump past tombstoned npm versions\n\n${summary}`;
    execSync(`git commit -m ${JSON.stringify(body)}`, { stdio: 'inherit' });
    execSync('git push', { stdio: 'inherit' });
  } catch (err) {
    console.warn('Failed to push the tombstone bump commit. The bumped versions are in the working tree; commit manually.');
    console.warn(err instanceof Error ? err.message : String(err));
  }
}

function printUsage() {
  console.log(
    [
      'Usage: node scripts/safe-publish.mjs [--dry-run] [--help]',
      '',
      'Publishes the non-private packages under packages/ in dependency order,',
      'skipping versions already on npm and auto-bumping past tombstoned slots.',
      '',
      '  --dry-run  print the resolved publish order and exit (no registry/git access)',
      '  --help     this message',
    ].join('\n'),
  );
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    printUsage();
    return 0;
  }
  const dryRun = argv.includes('--dry-run');

  let ordered;
  const packages = listPublishablePackages();
  if (packages.length === 0) {
    console.log('No publishable workspace packages found under packages/.');
    return 0;
  }
  try {
    ordered = topoSortPackages(packages);
  } catch (err) {
    console.error(`::error::${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  const publishableNames = new Set(ordered.map((p) => p.pkg.name));

  if (dryRun) {
    console.log('Publish order (dependencies first):');
    for (const { pkg } of ordered) {
      const deps = workspaceDepNames(pkg, publishableNames);
      console.log(
        `  ${pkg.name}@${pkg.version}${deps.length ? `  (after: ${deps.join(', ')})` : ''}`,
      );
    }
    console.log('\nDry run — nothing was published.');
    return 0;
  }

  const results = [];
  const bumps = [];
  // Packages whose publish failed (or was blocked) — their dependents must
  // NOT publish, or they'd ship exact pins on versions that never landed.
  const failedNames = new Set();

  for (const { dir, pkg } of ordered) {
    console.log(`\n=== ${pkg.name}@${pkg.version} ===`);

    const blockedBy = workspaceDepNames(pkg, publishableNames).filter((d) => failedNames.has(d));
    if (blockedBy.length > 0) {
      console.error(
        `::error::NOT publishing ${pkg.name}@${pkg.version}: workspace dependenc${blockedBy.length === 1 ? 'y' : 'ies'} ${blockedBy.join(', ')} failed to publish. ` +
          'Publishing it would pin a dependency version that never shipped.',
      );
      results.push({ name: pkg.name, version: pkg.version, status: 'blocked' });
      failedNames.add(pkg.name);
      continue;
    }

    if (alreadyPublished(pkg.name, pkg.version)) {
      console.log('  → already on npm, skipping');
      results.push({ name: pkg.name, version: pkg.version, status: 'skipped' });
      continue;
    }

    let current = pkg;
    let attempts = 0;
    let outcome = null;

    while (attempts <= MAX_BUMP_ATTEMPTS) {
      const r = tryPublish(dir);
      if (r.code === 0) {
        console.log(`  ✓ published ${current.name}@${current.version}`);
        createGitTag(current.name, current.version);
        announceTag(current.name, current.version);
        outcome = { status: 'published', version: current.version };
        break;
      }

      const tombstone = matchesAny(r.stderr, TOMBSTONE_PATTERNS);
      const alreadyVisible = !tombstone && matchesAny(r.stderr, ALREADY_PUBLISHED_PATTERNS);

      if (alreadyVisible) {
        console.log(`  → ${current.name}@${current.version} is already on the registry, skipping`);
        outcome = { status: 'skipped', version: current.version };
        break;
      }

      if (!tombstone) {
        console.error(`::error::publish failed for ${current.name}@${current.version}`);
        console.error(r.stderr.trim());
        outcome = { status: 'failed', version: current.version, error: r.stderr.slice(0, 800) };
        break;
      }

      attempts += 1;
      if (attempts > MAX_BUMP_ATTEMPTS) {
        console.error(
          `::error::${current.name}@${current.version} is tombstoned and ${MAX_BUMP_ATTEMPTS} consecutive bumps were also tombstoned. Bump manually.`,
        );
        outcome = { status: 'failed', version: current.version, error: 'tombstone-exhausted' };
        break;
      }

      const next = bumpPatch(current.version);
      console.warn(
        `::warning::${current.name}@${current.version} is tombstoned, bumping to ${next} (attempt ${attempts}/${MAX_BUMP_ATTEMPTS})`,
      );
      bumps.push({ dir, name: current.name, from: current.version, to: next });
      current = { ...current, version: next };
      // Persisting the bump to package.json is load-bearing twice over: it is
      // what the retried `pnpm publish` reads, AND what a later dependent's
      // pack reads when rewriting its `workspace:*` pin to this new version.
      writePkg(dir, current);
    }

    if (outcome.status === 'failed') failedNames.add(current.name);
    results.push({ name: current.name, ...outcome });
  }

  console.log('\n----- Publish summary -----');
  const longest = Math.max(...results.map((r) => r.name.length), 1);
  for (const r of results) {
    console.log(`  ${r.status.padEnd(10)} ${r.name.padEnd(longest)} ${r.version}`);
  }

  // Consolidate per-package bumps to one entry per package (final version),
  // in case a package walked through several tombstones.
  const finalBumps = [];
  for (const b of bumps) {
    const existing = finalBumps.find((x) => x.name === b.name);
    if (existing) {
      existing.to = b.to;
    } else {
      finalBumps.push({ ...b });
    }
  }
  commitBumps(finalBumps);

  // Post-publish consistency check: every @moxxy/* pin that shipped in this
  // run must exist on the registry. A miss means an installable-but-broken
  // package is LIVE — fail loudly so a human publishes the missing version
  // immediately (the dependent cannot be unshipped; npm slots are permanent).
  const published = results.filter((r) => r.status === 'published');
  let consistencyFailed = false;
  if (published.length > 0) {
    console.log('\n----- Post-publish dependency consistency check -----');
    const problems = await findShippedDepProblems(published, {
      shippedManifest: (name, version) => fetchShippedManifest(name, version),
      versionExists: (name, version) => versionExistsWithRetry(name, version),
    });
    if (problems.length === 0) {
      console.log('  ✓ every shipped @moxxy/* dependency pin exists on the registry');
    } else {
      consistencyFailed = true;
      for (const p of problems) {
        console.error(`::error::DEPENDENCY CONSISTENCY FAILURE: ${p.pkg} — ${p.problem}`);
      }
      console.error(
        '::error::A published package references an @moxxy/* version that is not on npm. ' +
          'It is LIVE and broken for installers. Publish the missing dependency version ' +
          '(or bump + republish the dependent) IMMEDIATELY.',
      );
    }
  }

  const failed = results.filter((r) => r.status === 'failed' || r.status === 'blocked');
  if (failed.length > 0 || consistencyFailed) {
    if (failed.length > 0) console.error(`\n${failed.length} package(s) failed or were blocked.`);
    return 1;
  }
  return 0;
}

// Only publish when invoked directly (`node scripts/safe-publish.mjs`);
// importing the module (unit tests) must stay side-effect free.
const invokedDirectly =
  process.argv[1] != null && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  process.exit(await main());
}
