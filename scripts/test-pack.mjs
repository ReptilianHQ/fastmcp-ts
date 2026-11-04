#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const [pack] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], {
  cwd: new URL('../', import.meta.url), encoding: 'utf8',
}));
for (const path of ['LICENSE', 'NOTICE']) {
  assert(pack.files.some(file => file.path === path), `Packed artifact is missing ${path}`);
}
console.log('Packed artifact includes LICENSE and NOTICE.');
