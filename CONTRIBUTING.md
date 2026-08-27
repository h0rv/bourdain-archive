# Contributing

## Entries

- One YAML file per entry under `src/content/`.
- Lowercase hyphenated IDs.
- Original summaries only.
- No full text, mirrors, uploads, or transcripts.
- Use `needs-review` when unsure.

## Status

- `confirmed`
- `needs-review`
- `missing-source`
- `dead-link`
- `partial`

## Public media links

An availability link must open the item named on the page.

For a television episode, use this order:

1. `official_url` for an exact broadcaster or producer episode page.
2. `reference_url` for an exact TMDB, IMDb, or TVDB episode record.
3. `archive_url` for a preserved copy of an exact episode page.
4. `video_url` or `streaming_url` only when it opens that episode.

Put show-wide guides, season pages, schedules, recaps, and research links in
`sources` or `source_url`. Do not label them as episode availability. A Wikipedia
series article and a TVDB all-seasons page may verify an episode list, but neither
is an episode action.

Store a TMDB episode tuple in `identifiers.tmdb` as
`tv:{series id}:s{season}:e{episode}`. This keeps the identity reconstructable if
the public page URL changes. If TMDB does not carry the episode, store its exact
IMDb title ID in `identifiers.imdb` instead.

Use the same rule for films. `official_url` is the film's own distributor page.
Press releases, reviews, cast lists, and filmographies belong in `sources`.

## Local

```sh
npm install
npm run dev
npm run build
```
