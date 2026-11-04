#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const base = /^(\d+\.\d+\.\d+)-reptilian\.\d+$/.exec(pkg.version)?.[1];
if (!base) throw new Error(`Cannot derive the upstream base from ${pkg.version}`);
const root = new URL('../', import.meta.url);
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
if (git('rev-parse', '--is-shallow-repository') === 'true') {
  throw new Error('Upstream ancestry verification requires complete Git history');
}
git('fetch', '--no-tags', 'https://github.com/PrefectHQ/fastmcp-ts.git', `refs/tags/v${base}`);
const upstream = git('rev-parse', 'FETCH_HEAD^{commit}');
try {
  git('merge-base', '--is-ancestor', upstream, 'HEAD');
} catch {
  throw new Error(`Fork ${pkg.version} does not contain upstream v${base} (${upstream})`);
}
console.log(`Verified ${pkg.version}: upstream v${base} (${upstream}) is an ancestor of ${git('rev-parse', 'HEAD')}.`);
