#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import YAML from 'yaml';

const ROOT = 'src/content/series';
const CONCURRENCY = 1;
const TIMEOUT_MS = 20_000;
const REQUEST_GAP_MS = 1_500;
const MAX_RETRIES = 8;

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function loadEpisodeLinks() {
  const links = [];
  for (const show of await readdir(ROOT)) {
    const directory = join(ROOT, show, 'episodes');
    let names;
    try {
      names = await readdir(directory);
    } catch {
      continue;
    }

    for (const name of names) {
      if (!name.endsWith('.yaml') && !name.endsWith('.yml')) continue;
      const path = join(directory, name);
      const data = YAML.parse(await readFile(path, 'utf8'));
      if (data.availability?.reference_url) {
        links.push({
          path,
          title: data.title,
          season: data.season,
          episode: data.episode,
          special:
            data.tags?.includes('compilation') ||
            /special|behind the scenes|food porn|burning questions|techniques|issues|making of|off the charts|seven deadly|sex, drugs|obsessed/i.test(data.title),
          url: data.availability.reference_url,
        });
      }
    }
  }
  return links;
}

async function verify(link) {
  let response;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    response = await fetch(link.url, {
      headers: { 'user-agent': 'BourdainArchiveLinkAudit/1.0' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status !== 429 || attempt === MAX_RETRIES) break;
    const retryAfter = Number(response.headers.get('retry-after'));
    await wait(Number.isFinite(retryAfter) ? retryAfter * 1_000 : 15_000);
  }
  const html = await response.text();
  const expectedPath = new URL(link.url).pathname;
  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/i)?.[1];
  const canonicalPath = canonical ? new URL(canonical).pathname : undefined;
  const valid = response.ok && canonicalPath === expectedPath && !/page not found/i.test(html);
  return { ...link, status: response.status, canonical, valid };
}

const allLinks = await loadEpisodeLinks();
let links = allLinks;
if (process.argv.includes('--sample')) {
  const boundaries = new Set();
  const groups = new Map();
  for (const link of allLinks) {
    const key = `${new URL(link.url).pathname.split('/')[2]}:${link.season}`;
    const group = groups.get(key) ?? [];
    group.push(link);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    group.sort((left, right) => left.episode - right.episode);
    boundaries.add(group[0].path);
    boundaries.add(group.at(-1).path);
  }
  links = allLinks.filter((link) => link.special || boundaries.has(link.path));
}
const results = new Array(links.length);
let cursor = 0;

async function worker() {
  while (cursor < links.length) {
    const index = cursor;
    cursor += 1;
    try {
      results[index] = await verify(links[index]);
    } catch (error) {
      results[index] = { ...links[index], valid: false, error: error.message };
    }
    if ((index + 1) % 25 === 0) console.log(`checked ${index + 1}/${links.length}`);
    await wait(REQUEST_GAP_MS);
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

const failures = results.filter((result) => !result.valid);
console.log(`verified ${results.length - failures.length}/${results.length} exact episode reference URLs`);
for (const failure of failures) {
  console.error(`${failure.path}: ${failure.status ?? failure.error} ${failure.url}`);
}
if (failures.length > 0) process.exitCode = 1;
