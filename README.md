# Bourdain Archive

Minimal searchable index of Anthony Bourdain's work, appearances, screen roles,
primary web material, and the sources needed to verify them. The archive should
feel closer to a library finding aid than a fan site: search first, plain lists,
small filters, legal links out.

## Run

```sh
npm install
npm run dev
```

## Build

```sh
npm run build
```

## Archive sources

```sh
npm run archive
```

Raw snapshots live in `archive/raw/`. Converted data lives in `archive/derived/`. Add sources in `archive/sources.json`.

## Data

One YAML file per entry under `src/content/`.

```yaml
id: kitchen-confidential
title: Kitchen Confidential
type: book
date: "2000"
date_precision: year
summary: Original short summary.
image_url: https://covers.openlibrary.org/b/isbn/9780060899226-M.jpg
tags: []
people: []
places: []
sources: []
related: []
status: needs-review
availability:
  official_url:
  archive_url:
  library_url:
  audio_url:
  video_url:
  transcript_url:
  streaming_url:
  purchase_url:
```

No book text. No article mirrors. No episode uploads. No transcripts.

## Scope

Include:

- Works Bourdain authored or co-authored: books, essays, comics, articles, field notes, Tumblr/Medium/Li.st writing.
- Series he hosted, narrated, judged, created, or executive produced.
- Screen work where he acted, appeared as himself, voiced a role, wrote, consulted, produced, or was adapted while alive.
- Legacy/about records for posthumous material when useful, clearly tagged `posthumous`.

Do not treat posthumous documentaries or biopics as Bourdain-authored work.

## Images

Use images as a visual index, not a scraped media archive.

- Self-host only images with clear reusable rights and attribution.
- Use Open Library covers and OpenGraph images as remote previews.
- Index Tumblr, CNN, and editorial photo posts by source URL; do not bulk mirror their media.
- Store attribution before adding local assets: creator, source URL, license, rights status, credit line, and usage policy.

## Inspiration

https://www.searchartwith.art/
https://wholeearth.info/
