#!/usr/bin/env node

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import YAML from 'yaml';

const SERIES_ROOT = 'src/content/series';
const TMDB_SERIES = new Map([
  ['a-cooks-tour-show', { id: 2361, path: '2361-a-cook-s-tour' }],
  ['no-reservations-show', { id: 4533, path: '4533-no-reservations' }],
  ['parts-unknown-show', { id: 56305, path: '56305-anthony-bourdain-parts-unknown' }],
  ['the-layover-show', { id: 41993, path: '41993-the-layover' }],
]);
const IMDB_EPISODES = new Map([
  ['no-reservations-s02e14-special-anthony-bourdain-in-beirut', 'tt0944985'],
  ['no-reservations-s03e16-holiday-special', 'tt1153743'],
]);

function exactOfficialEpisodeUrl(value) {
  if (!value) return false;
  const url = new URL(value);
  const host = url.hostname.replace(/^www\./, '');
  const path = url.pathname;

  if (host.endsWith('travelchannel.com')) return path.includes('/episodes/');
  if (host === 'explorepartsunknown.com') return !path.startsWith('/destination/');
  if (host === 'cnn.com') return path.startsWith('/travel/article/') && /parts-unknown-season-\d+-ep-\d+/.test(path);
  return false;
}

function keepAsResearchUrl(value) {
  if (!value) return false;
  const url = new URL(value);
  const host = url.hostname.replace(/^www\./, '');
  if (host.endsWith('wikipedia.org')) return false;
  if (host === 'thetvdb.com') return false;
  return true;
}

async function episodeFiles() {
  const files = [];
  for (const show of await readdir(SERIES_ROOT)) {
    const directory = join(SERIES_ROOT, show, 'episodes');
    try {
      for (const name of await readdir(directory)) {
        if (name.endsWith('.yaml') || name.endsWith('.yml')) files.push(join(directory, name));
      }
    } catch {
      // A series may have no episode records.
    }
  }
  return files;
}

let official = 0;
let reference = 0;
let movedToResearch = 0;

for (const path of await episodeFiles()) {
  const text = await readFile(path, 'utf8');
  const normalizedText = text.replace(/\navailability: \{\}\n/g, '\n');
  const data = YAML.parse(normalizedText);
  const tmdbSeries = TMDB_SERIES.get(data.parent_id);
  if (!tmdbSeries || data.season == null || data.episode == null) {
    throw new Error(`${path}: cannot build an exact TMDB episode URL`);
  }

  const oldOfficial = data.availability?.official_url;
  const imdbEpisode = IMDB_EPISODES.get(data.id);
  const availabilityMatch = normalizedText.match(/\navailability:\n((?: {2}[^\n]+\n?)*)$/);
  const keptAvailabilityLines = (availabilityMatch?.[1] ?? '')
    .split('\n')
    .filter((line) => line && !/^  (official_url|reference_url):/.test(line));
  let newActionLine;
  let researchUrl;

  if (exactOfficialEpisodeUrl(oldOfficial)) {
    newActionLine = `  official_url: ${oldOfficial}`;
    official += 1;
  } else {
    newActionLine = imdbEpisode
      ? `  reference_url: https://www.imdb.com/title/${imdbEpisode}/`
      : `  reference_url: https://www.themoviedb.org/tv/${tmdbSeries.path}/season/${data.season}/episode/${data.episode}`;
    reference += 1;
    if (keepAsResearchUrl(oldOfficial) && !data.source_url) {
      researchUrl = oldOfficial;
      movedToResearch += 1;
    }
  }

  const availabilityBlock = `\navailability:\n${[...keptAvailabilityLines, newActionLine].join('\n')}\n`;
  let updated = availabilityMatch
    ? normalizedText.replace(availabilityMatch[0], availabilityBlock)
    : `${normalizedText.trimEnd()}${availabilityBlock}`;
  if (researchUrl) updated = updated.replace('\navailability:\n', `\nsource_url: ${researchUrl}\navailability:\n`);
  const tmdbIdentifier = `tv:${tmdbSeries.id}:s${data.season}:e${data.episode}`;
  if (imdbEpisode) {
    updated = updated.replace(/^  tmdb:.*\n/m, '');
    if (!data.identifiers?.imdb) {
      updated = updated.replace(/\nidentifiers:\n/, `\nidentifiers:\n  imdb: "${imdbEpisode}"\n`);
    }
  } else if (!data.identifiers?.tmdb) {
    const identifiersMatch = updated.match(/\nidentifiers:\n((?: {2}[^\n]+\n?)*)/);
    if (identifiersMatch) {
      updated = updated.replace(identifiersMatch[0], `${identifiersMatch[0].trimEnd()}\n  tmdb: "${tmdbIdentifier}"\n`);
    } else {
      updated = updated.replace('\navailability:\n', `\nidentifiers:\n  tmdb: "${tmdbIdentifier}"\navailability:\n`);
    }
  }
  await writeFile(path, updated, 'utf8');
}

console.log(`${official} exact official episode pages kept`);
console.log(`${reference} exact catalog episode records added`);
console.log(`${movedToResearch} non-action URLs retained as research source_url values`);
