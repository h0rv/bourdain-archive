# Archive data

Archive data is intentionally separate from site content.

## Layers

- `archive/raw/` — snapshots as found: CSV, JSON, Markdown, etc.
- `archive/derived/` — normalized JSON generated from raw snapshots.
- `src/content/` — curated entries shown on the site.

Do not edit generated `archive/derived/` files by hand. Edit the raw/curated source or converter instead.

## Commands

```sh
npm run archive
npm run import:literature
npm run validate:data
```

## Policy

- Commit metadata, CSV, JSON, Markdown, and link indexes.
- Do not commit copyrighted article full text, episode uploads, book text, or transcript dumps.
- For ephemeral sources, prefer raw metadata snapshots plus outbound-link indexes.
