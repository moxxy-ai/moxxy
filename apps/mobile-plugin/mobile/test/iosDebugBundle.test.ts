import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('iOS debug bundle fallback', () => {
  it('prefers the embedded JS bundle before falling back to a development URL', () => {
    const appDelegate = readFileSync(resolve(process.cwd(), 'ios/MoxxyMobileGateway/AppDelegate.swift'), 'utf8');

    expect(appDelegate).toContain('bundleURL() ?? bridge.bundleURL');
    expect(appDelegate).toContain('bundledJSBundleURL() ?? developmentBundleURL()');
    expect(appDelegate).not.toContain('bridge.bundleURL ?? bundleURL()');
  });

  it('does not skip bundling for every Debug build by default', () => {
    const project = readFileSync(
      resolve(process.cwd(), 'ios/MoxxyMobileGateway.xcodeproj/project.pbxproj'),
      'utf8',
    );

    expect(project).not.toContain('if [[ "$CONFIGURATION" = *Debug* ]]; then\\n  export SKIP_BUNDLING=1\\nfi');
    expect(project).toContain('MOXXY_SKIP_DEBUG_BUNDLING');
    expect(project).toContain('FORCE_BUNDLING=1');
    expect(project).toContain('--dev false');
  });

  it('declares the Babel toolchain used by embedded iOS bundling', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect({
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    }).toHaveProperty('@babel/plugin-transform-react-jsx');
    expect({
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    }).toHaveProperty('babel-preset-expo');
  });

  it('does not add the JSX transform directly to the Babel config', () => {
    const babelConfig = readFileSync(resolve(process.cwd(), 'babel.config.cjs'), 'utf8');

    expect(babelConfig).not.toContain('@babel/plugin-transform-react-jsx');
  });
});
