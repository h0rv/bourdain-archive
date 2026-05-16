#!/usr/bin/env node
/**
 * Validate that static local href/src references emitted into dist resolve.
 */

import { access, readdir, readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const DIST = 'dist';
const errors = [];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    if (entry.isFile()) files.push(path);
  }
  return files;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function localUrlTarget(raw) {
  if (!raw || raw.startsWith('#')) return undefined;
  if (/^(https?:|mailto:|tel:|data:|javascript:)/i.test(raw)) return undefined;
  const withoutHash = raw.split('#')[0].split('?')[0];
  if (!withoutHash || withoutHash.startsWith('//')) return undefined;
  return withoutHash;
}

async function resolves(url) {
  const clean = decodeURIComponent(url);
  const path = clean.startsWith('/') ? clean.slice(1) : clean;
  const candidates = [];

  if (clean.endsWith('/')) candidates.push(join(DIST, path, 'index.html'));
  else if (extname(clean)) candidates.push(join(DIST, path));
  else candidates.push(join(DIST, path, 'index.html'), join(DIST, `${path}.html`));

  for (const candidate of candidates) {
    const normalized = normalize(candidate);
    if (!normalized.startsWith(DIST)) continue;
    if (await exists(normalized)) return true;
  }
  return false;
}

const htmlFiles = (await walk(DIST)).filter((file) => file.endsWith('.html'));
const attrRe = /\s(?:href|src)=["']([^"']+)["']/g;

for (const file of htmlFiles) {
  const html = await readFile(file, 'utf8');
  for (const match of html.matchAll(attrRe)) {
    const url = localUrlTarget(match[1]);
    if (!url) continue;
    if (!(await resolves(url))) errors.push(`${file}: local reference does not resolve: ${match[1]}`);
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`error: ${error}`);
  process.exitCode = 1;
} else {
  console.log(`validated local routes/assets in ${htmlFiles.length} HTML files`);
}
