# Bourdain Index

A lean static site for indexing Anthony Bourdain’s life and work.

## What this is

Bourdain Index is an open-source index and reading guide for Bourdain’s books, articles, television, interviews, appearances, places, themes, and sources.

## What this is not

It is not a content mirror, streaming site, transcript archive, database server, or analytics product.

## Run locally

```sh
npm install
npm run dev
```

Build the static site:

```sh
npm run build
```

## Add an entry

Create one YAML file in the right collection under `src/content/`, for example `src/content/works/kitchen-confidential.yaml`.

Use lowercase hyphenated IDs and keep summaries original. Unknown URL fields may be left blank or set to `null`.

## Data format

Main entries use common fields:

```yaml
id: kitchen-confidential
title: Kitchen Confidential
type: book
date: "2000"
date_precision: year
summary: Original short summary.
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

## Source and copyright policy

Do not host copyrighted books, full articles, full episode videos, or unauthorized transcripts. Link to official sources, public archives, libraries, and source metadata.

## Contribute

See [CONTRIBUTING.md](CONTRIBUTING.md).

## GitHub Pages

The included workflow builds Astro and deploys `dist/` to GitHub Pages on pushes to `main`.
