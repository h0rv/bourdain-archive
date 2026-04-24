# Bourdain Archive

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
