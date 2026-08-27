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
const COLLECTIONS_EXPECTING_VISUALS = new Set(['works', 'series', 'appearances', 'screen', 'events', 'literature']);
const BLOCKED_IMAGE_HOSTS = new Set([
  'opengraph.githubassets.com',
  'interviews.televisionacademy.com',
  's0.wp.com',
]);
const PLACEHOLDER_IMAGE_HOSTS = new Set(['placehold.co', 'placeholder.com', 'via.placeholder.com']);
const BLOCKED_IMAGE_PATHS = [/^archive\.org\/services\/img\/The_Nerdist_Podcast_528$/i];

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
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    const hostAndPath = `${host}${parsed.pathname}`;
    return BLOCKED_IMAGE_HOSTS.has(host) || BLOCKED_IMAGE_PATHS.some((pattern) => pattern.test(hostAndPath));
  } catch {
    return false;
  }
}

function isPlaceholderRemoteImage(url) {
  if (!url || !/^https?:\/\//.test(url)) return false;
  try {
    return PLACEHOLDER_IMAGE_HOSTS.has(new URL(url).hostname.replace(/^www\./, ''));
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

function previewImageFor(data, cache, sourceById = new Map(), seen = new Set()) {
  if (data.image_url && !isBlockedRemoteImage(data.image_url) && !isPlaceholderRemoteImage(data.image_url)) {
    return { image: data.image_url, reason: 'explicit image_url' };
  }
  const url = primaryAvailabilityUrl(data);
  const videoId = youtubeId(url);
  if (videoId) return { image: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, reason: 'YouTube thumbnail fallback' };
  const image = url ? cache[url]?.image : undefined;
  if (image && !isBlockedRemoteImage(image)) return { image, reason: `cached preview image for ${url}` };
  if (image && isBlockedRemoteImage(image)) return { image: undefined, reason: `cached preview image is blocked: ${image}` };

  for (const sourceId of data.sources ?? []) {
    if (seen.has(sourceId)) continue;
    seen.add(sourceId);
    const source = sourceById.get(sourceId);
    if (!source) continue;
    const sourceImage = previewImageFor(source, cache, sourceById, seen);
    if (sourceImage.image) return { ...sourceImage, reason: `source ${sourceId}: ${sourceImage.reason}` };
  }

  const reasons = [];
  if (!data.image_url) reasons.push('no image_url');
  if (!url) reasons.push('no availability/source URL to preview');
  else if (!cache[url]) reasons.push(`no cached preview for ${url}`);
  else if (!cache[url]?.image) reasons.push(`cached preview has no image for ${url}`);
  if ((data.sources ?? []).length === 0) reasons.push('no source refs with fallback previews');
  return { image: undefined, reason: reasons.join('; ') };
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
const sourceById = new Map(entries.filter((entry) => entry.collection === 'sources').map((entry) => [entry.data.id, entry.data]));

for (const [url, preview] of Object.entries(previewCache)) {
  if (isBlockedRemoteImage(preview?.image)) {
    warnings.push(`${PREVIEW_CACHE}: ignored blocked preview image for ${url}: ${preview.image}`);
  }
}

const missingByCollection = new Map();

for (const { file, collection, data } of entries) {
  if (data.image_url && isPlaceholderRemoteImage(data.image_url)) {
    errors.push(`${file}: image_url uses a generated placeholder host: ${data.image_url}`);
  }

  if (data.image_url && isBlockedRemoteImage(data.image_url)) {
    errors.push(`${file}: image_url uses blocked broken host: ${data.image_url}`);
  }

  const localPath = localAssetPath(data.image_url);
  if (localPath && !(await exists(localPath))) {
    errors.push(`${file}: local image_url is missing: ${data.image_url}`);
  }

  if (!COLLECTIONS_EXPECTING_VISUALS.has(collection)) continue;
  const previewImage = previewImageFor(data, previewCache, sourceById);
  if (!previewImage.image) {
    const count = missingByCollection.get(collection) ?? 0;
    missingByCollection.set(collection, count + 1);
    if (data.index_mode !== 'child') {
      warnings.push(`${file}: no safe image_url or preview image (${previewImage.reason})`);
    }
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
