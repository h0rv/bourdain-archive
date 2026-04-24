# Contributing

Bourdain Index is a source-forward metadata project.

## Entry rules

- Add one YAML file per entry under `src/content/`.
- Use stable, lowercase, hyphenated IDs.
- Write original summaries. Do not paste copyrighted full text or unauthorized transcripts.
- Link to official, archive, library, streaming, purchase, audio, or video sources when available.
- Use `needs-review` when metadata is incomplete or not source-backed.

## Status values

- `confirmed`: source-backed and reasonably complete
- `needs-review`: added from memory or seed data, needs verification
- `missing-source`: known item, no good source attached yet
- `dead-link`: source exists but is unavailable/dead
- `partial`: important metadata is missing

## Local development

```sh
npm install
npm run dev
```

Run `npm run build` before opening a pull request.
