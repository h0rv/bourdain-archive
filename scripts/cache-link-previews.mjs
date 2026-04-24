#!/usr/bin/env node
/**
 * Build-time link preview cache.
 *
 * Reads URLs from src/content, fetches HTML pages, extracts OpenGraph/Twitter
 * preview metadata, and writes archive/derived/link-previews.json.
 *
 * Favicons/YouTube thumbnails are handled in src/lib/content.ts. This cache is
 * for prettier article/site preview images when the upstream page exposes them.
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';

const CONTENT_ROOT = 'src/content';
const OUT = 'archive/derived/link-previews.json';
const USER_AGENT = 'bourdain-archive/0.1 link preview fetcher';
const REFRESH = process.argv.includes('--refresh');
const CONCURRENCY = 4;
const TIMEOUT_MS = 10_000;
const HTML_TYPES = ['text/html', 'application/xhtml+xml'];

function htmlDecode(value) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .trim();
}

function parseYamlUrls(text) {
  const urls = [];
  for (const match of text.matchAll(/^\s*[A-Za-z0-9_]*url:\s*(https?:\/\/\S+)\s*$/gm)) {
    urls.push(match[1].replace(/^['"]|['"]$/g, ''));
  }
  return urls;
}

function collectJsonUrls(value, urls = []) {
  if (typeof value === 'string') {
    if (value.startsWith('http://') || value.startsWith('https://')) urls.push(value);
    return urls;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectJsonUrls(item, urls);
    return urls;
  }
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) collectJsonUrls(child, urls);
  }
  return urls;
}

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

function isSkippable(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    if (host === 'covers.openlibrary.org') return true;
    if (host === 'i.ytimg.com') return true;
    if (host === 'google.com' || host.endsWith('.google.com')) return true;
    return false;
  } catch {
    return true;
  }
}

async function contentUrls() {
  const files = await walk(CONTENT_ROOT);
  const urls = [];
  for (const file of files) {
    const ext = extname(file);
    const text = await readFile(file, 'utf8');
    if (ext === '.json') urls.push(...collectJsonUrls(JSON.parse(text)));
    if (ext === '.yaml' || ext === '.yml') urls.push(...parseYamlUrls(text));
  }
  return Array.from(new Set(urls)).filter((url) => !isSkippable(url)).sort();
}

function metaContent(html, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escaped}["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${escaped}["'][^>]*>`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return htmlDecode(match[1]);
  }
  return undefined;
}

function titleContent(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? htmlDecode(match[1].replace(/\s+/g, ' ')) : undefined;
}

function absolutize(url, base) {
  if (!url) return undefined;
  try {
    return new URL(url, base).toString();
  } catch {
    return undefined;
  }
}

async function fetchPreview(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' },
    });
    const contentType = response.headers.get('content-type') ?? '';
    if (!response.ok) return { url, ok: false, status: response.status, fetched_at: new Date().toISOString() };
    if (!HTML_TYPES.some((type) => contentType.includes(type))) {
      return { url, ok: false, status: response.status, content_type: contentType, fetched_at: new Date().toISOString() };
    }

    const html = await response.text();
    const finalUrl = response.url || url;
    const image = absolutize(
      metaContent(html, 'og:image:secure_url') ??
      metaContent(html, 'og:image') ??
      metaContent(html, 'twitter:image') ??
      metaContent(html, 'twitter:image:src'),
      finalUrl,
    );
    const title = metaContent(html, 'og:title') ?? metaContent(html, 'twitter:title') ?? titleContent(html);
    const description = metaContent(html, 'og:description') ?? metaContent(html, 'description') ?? metaContent(html, 'twitter:description');

    return {
      url,
      final_url: finalUrl,
      ok: true,
      status: response.status,
      title,
      description,
      image,
      site_name: metaContent(html, 'og:site_name'),
      fetched_at: new Date().toISOString(),
    };
  } catch (error) {
    return { url, ok: false, error: error.name === 'AbortError' ? 'timeout' : error.message, fetched_at: new Date().toISOString() };
  } finally {
    clearTimeout(timeout);
  }
}

async function loadExisting() {
  try {
    const cache = JSON.parse(await readFile(OUT, 'utf8'));
    return cache.previews ?? {};
  } catch {
    return {};
  }
}

async function runQueue(items, worker) {
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

const urls = await contentUrls();
const existing = await loadExisting();
const toFetch = REFRESH ? urls : urls.filter((url) => !existing[url]);
console.log(`preview urls: ${urls.length}; fetching: ${toFetch.length}`);

const fetched = await runQueue(toFetch, async (url, index) => {
  const preview = await fetchPreview(url);
  const label = preview.ok ? (preview.image ? 'image' : 'no-image') : `fail:${preview.status ?? preview.error}`;
  console.log(`${index + 1}/${toFetch.length} ${label} ${url}`);
  return preview;
});

const previews = { ...existing };
for (const preview of fetched) previews[preview.url] = preview;

await mkdir(dirname(OUT), { recursive: true });
await writeFile(resolve(OUT), `${JSON.stringify({ generated_at: new Date().toISOString(), previews }, null, 2)}\n`, 'utf8');
