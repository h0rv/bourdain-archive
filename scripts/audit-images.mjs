#!/usr/bin/env node
/**
 * Image hygiene checks for archive content.
 *
 * This is intentionally offline-friendly. It verifies local assets, flags
 * preview patterns known to break, and reports entries that still rely on
 * metadata fallback instead of a safe visual.
 */

import { access, readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import YAML from 'yaml';

const CONTENT_ROOT = 'src/content';
const PUBLIC_ROOT = 'public';
const PREVIEW_CACHE = 'archive/derived/link-previews.json';
const COLLECTIONS_EXPECTING_VISUALS = new Set(['works', 'episodes', 'appearances', 'screen', 'events', 'literature']);
const BLOCKED_IMAGE_HOSTS = new Set(['interviews.televisionacademy.com']);

const errors = [];
const warnings = [];

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

function isBlockedRemoteImage(url) {
  if (!url || !/^https?:\/\//.test(url)) return false;
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return BLOCKED_IMAGE_HOSTS.has(host);
  } catch {
    return false;
  }
}

function youtubeId(url) {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') return parsed.pathname.split('/').filter(Boolean)[0];
    if (host.endsWith('youtube.com')) {
      if (parsed.searchParams.get('v')) return parsed.searchParams.get('v');
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (['embed', 'shorts', 'live'].includes(parts[0])) return parts[1];
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function primaryAvailabilityUrl(data) {
  const availability = data.availability ?? {};
  return (
    availability.video_url ??
    availability.audio_url ??
    availability.official_url ??
    availability.streaming_url ??
    availability.purchase_url ??
    availability.library_url ??
    availability.archive_url ??
    availability.transcript_url ??
    data.url ??
    undefined
  );
}

function previewImageFor(data, cache) {
  if (data.image_url) return data.image_url;
  const url = primaryAvailabilityUrl(data);
  const videoId = youtubeId(url);
  if (videoId) return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  const image = url ? cache[url]?.image : undefined;
  return isBlockedRemoteImage(image) ? undefined : image;
}

function localAssetPath(url) {
  if (!url?.startsWith('/')) return undefined;
  return join(PUBLIC_ROOT, url.replace(/^\/+/, ''));
}

async function loadPreviewCache() {
  try {
    const cache = JSON.parse(await readFile(PREVIEW_CACHE, 'utf8'));
    return cache.previews ?? {};
  } catch {
    return {};
  }
}

const previewCache = await loadPreviewCache();
const files = (await walk(CONTENT_ROOT)).filter((file) => ['.json', '.yaml', '.yml'].includes(extname(file)));
const entries = [];

for (const file of files) {
  const text = await readFile(file, 'utf8');
  const data = extname(file) === '.json' ? JSON.parse(text) : YAML.parse(text);
  const collection = file.split('/')[2];
  entries.push({ file, collection, data });
}

for (const [url, preview] of Object.entries(previewCache)) {
  if (isBlockedRemoteImage(preview?.image)) {
    errors.push(`${PREVIEW_CACHE}: blocked broken preview image for ${url}: ${preview.image}`);
  }
}

const missingByCollection = new Map();

for (const { file, collection, data } of entries) {
  if (data.image_url && isBlockedRemoteImage(data.image_url)) {
    errors.push(`${file}: image_url uses blocked broken host: ${data.image_url}`);
  }

  const localPath = localAssetPath(data.image_url);
  if (localPath && !(await exists(localPath))) {
    errors.push(`${file}: local image_url is missing: ${data.image_url}`);
  }

  if (!COLLECTIONS_EXPECTING_VISUALS.has(collection)) continue;
  const previewImage = previewImageFor(data, previewCache);
  if (!previewImage) {
    const count = missingByCollection.get(collection) ?? 0;
    missingByCollection.set(collection, count + 1);
    warnings.push(`${file}: no safe image_url or preview image`);
  }
}

for (const [collection, count] of Array.from(missingByCollection.entries()).sort()) {
  console.warn(`warn: ${collection}: ${count} entries still use metadata fallback`);
}
for (const warning of warnings) console.warn(`warn: ${warning}`);

if (errors.length > 0) {
  for (const error of errors) console.error(`error: ${error}`);
  process.exitCode = 1;
} else {
  console.log(`audited images for ${entries.length} content entries (${warnings.length} warnings)`);
}
