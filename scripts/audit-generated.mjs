#!/usr/bin/env node
/**
 * Audits the static Astro output for broken internal routes and local assets.
 *
 * Run after `npm run build`. Remote URLs are intentionally ignored here; they
 * belong in source/link availability audits, not generated-site correctness.
 */

import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

const DIST_ROOT = process.env.DIST_DIR ?? 'dist';
const PUBLIC_ROOT = process.env.PUBLIC_DIR ?? 'public';
const CONTENT_ROOT = process.env.CONTENT_DIR ?? 'src/content';
const BASE_PATH = normalizeBase(process.env.BASE_PATH ?? '/');
const IMAGE_EXTENSIONS = new Set(['.avif', '.gif', '.jpeg', '.jpg', '.png', '.svg', '.webp']);
const REPO_BASE_SEGMENT = path.basename(process.cwd());
const HTML_ATTR_RE = /<([a-z][a-z0-9:-]*)\b[^>]*?\s(href|src|poster)=["']([^"']+)["'][^>]*?>/gi;
const SRCSET_RE = /<(img|source)\b[^>]*?\ssrcset=["']([^"']+)["'][^>]*?>/gi;
const IMAGE_FIELD_RE = /(^|_)(asset|cover|image|photo|poster)(_|$)|thumbnail/i;

const errors = [];
let checkedRoutes = 0;
let checkedHtmlAssets = 0;
let checkedContentImages = 0;

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(child));
    if (entry.isFile()) files.push(child);
  }
  return files;
}

function normalizeBase(base) {
  const clean = `/${String(base).replace(/^\/+|\/+$/g, '')}`;
  return clean === '/' ? '/' : clean;
}

function stripHashAndQuery(value) {
  return value.split('#')[0].split('?')[0];
}

function isRemoteOrSpecial(value) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value) || value.startsWith('#') || value === '';
}

function decodeHtml(value) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

function distRelativeHtmlDir(htmlFile) {
  const relative = path.relative(DIST_ROOT, path.dirname(htmlFile)).split(path.sep).join('/');
  return relative === '' ? '/' : `/${relative}/`;
}

function normalizeGeneratedPath(rawValue, htmlFile) {
  const value = stripHashAndQuery(decodeHtml(rawValue).trim());
  if (isRemoteOrSpecial(value)) return undefined;

  let pathname = value;
  if (pathname.startsWith('/')) {
    if (BASE_PATH !== '/') {
      if (!pathname.startsWith(`${BASE_PATH}/`) && pathname !== BASE_PATH) {
        return {
          path: pathname,
          outsideBase: true,
          message: `root-relative URL does not include BASE_PATH ${BASE_PATH}`,
        };
      }
      pathname = pathname.slice(BASE_PATH.length) || '/';
    }
  } else {
    const dir = distRelativeHtmlDir(htmlFile);
    pathname = path.posix.normalize(path.posix.join(dir, pathname));
    if (!pathname.startsWith('/')) pathname = `/${pathname}`;
  }

  try {
    pathname = decodeURI(pathname);
  } catch {
    // Keep the raw path if decoding fails; the existence check will report it.
  }

  return { path: pathname };
}

function generatedCandidates(pathname) {
  const relative = pathname.replace(/^\/+/, '');
  if (relative === '') return [path.join(DIST_ROOT, 'index.html')];

  const candidatesFor = (target) => {
    if (target === '') return [path.join(DIST_ROOT, 'index.html')];
    const extension = path.extname(target);
    if (extension) return [path.join(DIST_ROOT, target)];
    return [
      path.join(DIST_ROOT, target, 'index.html'),
      path.join(DIST_ROOT, `${target}.html`),
    ];
  };

  const candidates = candidatesFor(relative);
  const parts = relative.split('/');
  if (parts[0] === REPO_BASE_SEGMENT) candidates.push(...candidatesFor(parts.slice(1).join('/')));
  return candidates;
}

async function assertGeneratedTarget(rawValue, htmlFile, kind) {
  const normalized = normalizeGeneratedPath(rawValue, htmlFile);
  if (!normalized) return;
  if (normalized.outsideBase) {
    errors.push(`${htmlFile}: ${kind} ${rawValue} ${normalized.message}`);
    return;
  }

  const candidates = generatedCandidates(normalized.path);
  const found = await Promise.any(candidates.map((candidate) => fileExists(candidate).then((exists) => exists ? candidate : Promise.reject())))
    .catch(() => undefined);

  if (!found) errors.push(`${htmlFile}: missing ${kind} target ${rawValue} -> ${normalized.path}`);
  if (kind === 'route') checkedRoutes += 1;
  if (kind === 'local asset') checkedHtmlAssets += 1;
}

function srcsetUrls(srcset) {
  return srcset
    .split(',')
    .map((candidate) => candidate.trim().split(/\s+/)[0])
    .filter(Boolean);
}

async function auditHtmlFile(filePath) {
  let html;
  try {
    html = await readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }

  for (const match of html.matchAll(HTML_ATTR_RE)) {
    const [, tagName, attr, rawValue] = match;
    if (tagName === 'a' && attr === 'href') await assertGeneratedTarget(rawValue, filePath, 'route');
    if ((tagName === 'img' || tagName === 'source' || attr === 'poster') && (attr === 'src' || attr === 'poster')) {
      await assertGeneratedTarget(rawValue, filePath, 'local asset');
    }
  }

  for (const match of html.matchAll(SRCSET_RE)) {
    for (const url of srcsetUrls(match[2])) {
      await assertGeneratedTarget(url, filePath, 'local asset');
    }
  }
}

async function loadContentFile(filePath) {
  const text = await readFile(filePath, 'utf8');
  if (filePath.endsWith('.json')) return JSON.parse(text);
  return YAML.parse(text);
}

function collectLocalImageRefs(value, filePath, refs, keyPath = []) {
  if (!value || typeof value !== 'object') return;

  for (const [key, child] of Object.entries(value)) {
    const nextPath = [...keyPath, key];
    if (typeof child === 'string') {
      const extension = path.extname(stripHashAndQuery(child)).toLowerCase();
      const keyLooksLikeImage = nextPath.some((part) => IMAGE_FIELD_RE.test(part));
      const valueLooksLikeImage = child.startsWith('/') && IMAGE_EXTENSIONS.has(extension);
      if (child.startsWith('/') && (keyLooksLikeImage || valueLooksLikeImage)) {
        refs.push({ filePath, keyPath: nextPath.join('.'), value: child });
      }
      continue;
    }

    if (Array.isArray(child)) {
      child.forEach((item, index) => collectLocalImageRefs(item, filePath, refs, [...nextPath, String(index)]));
      continue;
    }

    collectLocalImageRefs(child, filePath, refs, nextPath);
  }
}

async function auditContentImages() {
  if (!(await fileExists(CONTENT_ROOT))) return;
  const files = (await walk(CONTENT_ROOT)).filter((file) => /\.(json|ya?ml)$/i.test(file));
  const refs = [];

  for (const file of files) {
    const data = await loadContentFile(file);
    collectLocalImageRefs(data, file, refs);
  }

  for (const ref of refs) {
    const localPath = stripHashAndQuery(ref.value).replace(/^\/+/, '');
    const publicTarget = path.join(PUBLIC_ROOT, localPath);
    if (!(await fileExists(publicTarget))) {
      errors.push(`${ref.filePath}: missing local image ${ref.keyPath}: ${ref.value}`);
    }
    checkedContentImages += 1;
  }
}

if (!(await fileExists(DIST_ROOT))) {
  console.error(`error: ${DIST_ROOT} does not exist; run npm run build first`);
  process.exit(1);
}

const htmlFiles = (await walk(DIST_ROOT)).filter((file) => file.endsWith('.html'));
for (const file of htmlFiles) await auditHtmlFile(file);
await auditContentImages();

if (errors.length > 0) {
  for (const error of errors) console.error(`error: ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    `audited ${htmlFiles.length} HTML files, ${checkedRoutes} internal routes, ${checkedHtmlAssets} generated local assets, ${checkedContentImages} content image refs`,
  );
}
