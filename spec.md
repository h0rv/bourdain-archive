# MVP Spec: Bourdain Archive

## Goal

Build a **lean static site** for indexing Anthony Bourdain’s life and work.

The site should answer:

* What did Bourdain write, film, say, visit, and appear on?
* When did it happen?
* Where can I read/watch/listen to it legally?
* How does it connect to the rest of his work?

This is an **open-source index**, not a content mirror.

---

# Tech choice

## Use Astro

```txt
Astro + YAML + Markdown + plain CSS
```

Why:

* Generates static HTML
* GitHub Pages friendly
* Markdown/YAML friendly
* No backend
* No React required
* No database
* No auth
* No client JS unless added later
* Clean enough for a grug/HTMX/FastHTML-style site

---

# Hard constraints

* Static site only
* Deployable to GitHub Pages
* YAML data files
* No copyrighted full text
* No full episode mirrors
* No unauthorized transcripts
* No analytics by default
* No heavy JS
* No Tailwind
* No React
* No login
* No database server

---

# MVP pages

## 1. Homepage: Timeline

`/`

Primary experience.

Shows a chronological feed of:

* books
* articles/essays
* field notes
* TV episodes
* podcast/interview appearances
* major life/work events

Each item should show:

```txt
Year/date
Title
Type
Short summary
Tags
Source/availability badges
Link to detail page
```

---

## 2. Works

`/works/`

For:

* books
* essays
* articles
* field notes
* forewords
* comics
* posthumous collections

Basic filters can be simple links or sections:

```txt
Books
Articles
Field notes
Comics
Other
```

---

## 3. TV

`/tv/`

For:

* A Cook’s Tour
* No Reservations
* The Layover
* Parts Unknown
* Raw Craft
* other hosted/guest TV work

MVP can be simple list grouped by show.

---

## 4. Appearances

`/appearances/`

For:

* podcasts
* radio
* long-form interviews
* panels
* late-night appearances
* TV interviews
* book tour talks

This is one of the biggest gaps, so prioritize it.

---

## 5. Places

`/places/`

For:

* countries
* cities
* restaurants
* recurring locations

MVP is list-only. No map needed.

---

## 6. Themes

`/themes/`

For recurring ideas:

```txt
kitchens
travel
labor
class
addiction
new-york
vietnam
punk
war
food-media
fame
loneliness
```

Each theme page lists related entries.

---

## 7. Sources

`/sources/`

List every source used.

Each source should include:

* title
* URL
* type
* notes
* date accessed

---

## 8. About

`/about/`

Explain:

* what the project is
* what it is not
* copyright/source policy
* how to contribute

---

# MVP repo structure

```txt
bourdain-archive/
  src/
    content/
      works/
      episodes/
      appearances/
      places/
      people/
      themes/
      sources/

    pages/
      index.astro
      works/
      tv/
      appearances/
      places/
      themes/
      sources/
      about.md

    layouts/
    components/
    styles/global.css

  public/
  README.md
  CONTRIBUTING.md
  astro.config.mjs
  package.json
```

Keep it boring.

---

# Data model

Use one YAML file per entry.

## Common fields

Every main entry should have:

```yaml
id: string
title: string
type: string
date: string | null
date_precision: day | month | year | unknown
summary: string
tags: string[]
people: string[]
places: string[]
sources: string[]
related: string[]
status: confirmed | needs-review | missing-source | dead-link | partial
availability:
  official_url: string | null
  archive_url: string | null
  library_url: string | null
  audio_url: string | null
  video_url: string | null
  transcript_url: string | null
  streaming_url: string | null
  purchase_url: string | null
```

Do not over-model too early. Unknown fields can be blank/null.

---

# Entry types

Use these initial types:

```txt
book
article
essay
field-note
comic
episode
podcast
interview
radio
panel
video
life-event
place
person
theme
source
```

---

# Status values

```txt
confirmed
needs-review
missing-source
dead-link
partial
```

Definitions:

| Status           | Meaning                                         |
| ---------------- | ----------------------------------------------- |
| `confirmed`      | Source-backed and reasonably complete           |
| `needs-review`   | Added from memory/seed data, needs verification |
| `missing-source` | Known item but no good source attached yet      |
| `dead-link`      | Source exists but is unavailable/dead           |
| `partial`        | Entry exists but important metadata is missing  |

---

# Availability labels

The UI should derive badges from URLs/fields.

Examples:

```txt
Official
Archive
Library
Audio
Video
Transcript
Streaming
Purchase
Paywalled
Unknown
```

MVP can be dumb:

* if `official_url` exists: show `Official`
* if `archive_url` exists: show `Archive`
* if `audio_url` exists: show `Audio`
* if `video_url` exists: show `Video`
* if no availability URLs: show `Unknown`

---

# Example data

## Person

```yaml
id: anthony-bourdain
name: Anthony Bourdain
type: person
birth_date: "1956-06-25"
death_date: "2018-06-08"
summary: >
  Writer, cook, television host, traveler, and cultural figure.
sources: []
status: needs-review
```

---

## Work

```yaml
id: kitchen-confidential
title: Kitchen Confidential
type: book
date: "2000"
date_precision: year
summary: >
  Bourdain's breakout nonfiction book about restaurant work, kitchen culture,
  addiction, labor, and the mythology of cooks.
tags:
  - kitchens
  - new-york
  - labor
  - addiction
people:
  - anthony-bourdain
places:
  - new-york-city
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

---

## Episode

```yaml
id: parts-unknown-detroit
title: Detroit
type: episode
show: Parts Unknown
season: 2
episode: 8
date:
date_precision: unknown
summary: >
  Episode of Parts Unknown focused on Detroit.
tags:
  - detroit
  - america
  - labor
  - cities
people:
  - anthony-bourdain
places:
  - detroit
sources:
  - explore-parts-unknown-detroit
related:
  - field-notes-detroit
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

---

## Appearance

```yaml
id: jre-138
title: "Joe Rogan Experience #138: Anthony Bourdain"
type: podcast
date: "2011-09-11"
date_precision: day
host: Joe Rogan
duration_minutes: 150
summary: >
  Long-form podcast appearance with Anthony Bourdain.
tags:
  - podcast
  - travel
  - food-media
  - fame
people:
  - anthony-bourdain
  - joe-rogan
places: []
sources:
  - reddit-archival-megathread
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

---

## Theme

```yaml
id: kitchens
name: Kitchens
type: theme
summary: >
  Restaurant work, kitchen hierarchy, cooks, labor, violence, humor, craft,
  and the mythology of the professional kitchen.
related:
  - kitchen-confidential
sources: []
status: needs-review
```

---

## Source

```yaml
id: reddit-archival-megathread
title: Anthony Bourdain Archival Megathread
type: reddit-thread
url: https://www.reddit.com/r/AnthonyBourdain/comments/ai45r3/anthony_bourdain_archival_megathread/
accessed: "2026-04-24"
notes: >
  Fan archival thread collecting videos, TV appearances, podcasts, radio,
  blogs, and related links.
```

---

# Initial seed content

## Works

Seed these as `needs-review`:

```txt
Kitchen Confidential
A Cook's Tour
Typhoid Mary
Anthony Bourdain's Les Halles Cookbook
The Nasty Bits
No Reservations
Medium Raw
Appetites
World Travel
The Anthony Bourdain Reader
Bone in the Throat
Gone Bamboo
Get Jiro!
Get Jiro: Blood and Sushi
Hungry Ghosts
```

---

## TV

Seed show-level entries first:

```txt
A Cook's Tour
No Reservations
The Layover
Parts Unknown
Raw Craft
The Mind of a Chef
```

Then add a small number of episodes manually. Do not try to import everything on day one.

Good first episodes:

```txt
Parts Unknown: Detroit
Parts Unknown: Vietnam
Parts Unknown: Tokyo
Parts Unknown: New Jersey
No Reservations: Beirut
No Reservations: Vietnam
A Cook's Tour: Vietnam
```

---

## Appearances

Seed these as placeholders:

```txt
Joe Rogan Experience #138
Fresh Air interviews
WTF with Marc Maron
Nerdist Podcast
Television Academy interview
92NY talks
Charlie Rose appearances
Late Show appearances
CNN interviews
```

Prioritize appearances because existing Bourdain resources are weakest there.

---

## Places

Seed:

```txt
New York City
New Jersey
Detroit
Vietnam
Tokyo
Beirut
Paris
Hong Kong
Queens
Les Halles
```

---

## Themes

Seed:

```txt
kitchens
travel
labor
class
addiction
new-york
vietnam
punk
war
food-media
fame
loneliness
hospitality
fatherhood
```

---

# Seed resources

Use these as source entries and research starting points.

```txt
https://www.reddit.com/r/AnthonyBourdain/comments/ai45r3/anthony_bourdain_archival_megathread/

https://explorepartsunknown.com/

https://explorepartsunknown.com/detroit/bourdains-field-notes-detroit/

https://www.anthonybourdainworldmap.com/

https://github.com/cnlowery/anthony-bourdain-shows-by-country

https://github.com/underthecurve/bourdain-travel-places

https://interviews.televisionacademy.com/interviews/anthony-bourdain

https://freshairarchive.org/guests/anthony-bourdain

https://archive.org/details/The_Nerdist_Podcast_528
```

---

# MVP functionality

## Must have

* Static generated pages
* YAML content collections
* Timeline homepage
* Works index
* TV index
* Appearances index
* Places index
* Themes index
* Sources index
* Detail pages for entries
* Source links visible on detail pages
* Related entries visible on detail pages
* Status badges
* Availability badges
* Mobile-friendly CSS
* GitHub Pages deploy

## Nice but not MVP

* Search
* Map
* Filters
* Import scripts
* Link checker
* RSS feed
* Random entry
* Full text search
* Screenshots/images
* Automated scraping
* Admin UI

---

# Build order

## Step 1

Create Astro shell.

```txt
Base layout
nav
footer
global CSS
homepage
about page
```

## Step 2

Add YAML content collections.

```txt
works
episodes
appearances
places
people
themes
sources
```

## Step 3

Render indexes.

```txt
/works/
/tv/
/appearances/
/places/
/themes/
/sources/
```

## Step 4

Render detail pages.

```txt
/works/[id]/
/tv/[id]/
/appearances/[id]/
/places/[id]/
/themes/[id]/
```

## Step 5

Build homepage timeline from:

```txt
works
episodes
appearances
```

Only include entries with dates.

## Step 6

Seed enough data that the site feels real.

Minimum:

```txt
15 works
7 episodes/show entries
10 appearances
10 places
14 themes
8 sources
```

## Step 7

Deploy to GitHub Pages.

---

# UI principles

Keep it dead simple.

## Entry detail page

```txt
Title
Type · Date · Status

Summary

Availability
- Official
- Archive
- Audio
- Video
- Library

Tags

People

Places

Related

Sources
```

## Timeline item

```txt
2000
Kitchen Confidential
Book · kitchens · labor · New York
Bourdain's breakout nonfiction book...
```

## Index item

```txt
Kitchen Confidential
Book · 2000 · needs-review
```

---

# Copyright policy

Include this in `/about/`.

```txt
Bourdain Archive is an open-source index and reading guide.

It does not host copyrighted books, full articles, full episode videos, or unauthorized transcripts.

It links to official sources, public archives, libraries, and source metadata.

Short excerpts may be included only when necessary for identification, commentary, or research context.

If a source is paywalled, the project should link to the canonical source and mark it as paywalled.
```

---

# README requirements

README should include:

```txt
What this is
What this is not
How to run locally
How to add an entry
Data format
Source/copyright policy
How to contribute
GitHub Pages deploy notes
```

---

# Coding agent prompt

```txt
Build a lean Astro static site called Bourdain Archive.

Use:
- Astro
- YAML content collections
- Markdown for static pages
- plain custom CSS
- GitHub Pages deploy

Do not use:
- React
- Tailwind
- backend
- database
- auth
- analytics
- heavy client JS

The site is an open-source index and reading guide to Anthony Bourdain’s life and work. It should index books, articles, essays, field notes, TV episodes, interviews, podcasts, places, people, sources, and themes.

MVP pages:
- /
- /works/
- /tv/
- /appearances/
- /places/
- /themes/
- /sources/
- /about/

MVP functionality:
- YAML data files under src/content/
- one file per entry
- index pages for works, TV, appearances, places, themes, sources
- detail pages for each entry
- homepage timeline generated from dated works, episodes, and appearances
- status badges
- availability badges
- source links
- related entries
- mobile-friendly minimal CSS
- GitHub Pages deploy

Keep the implementation simple. Prefer boring generated HTML over clever abstractions.

Do not host copyrighted full text, full transcripts, or episode video. Only include metadata, original summaries, and links to official/archive/library sources.

Seed the site with a small but useful dataset:
- core Bourdain books
- show-level TV entries
- a few notable episodes
- initial podcast/interview appearances
- initial places
- initial themes
- source list
```

---

# Summary

Use **Astro + YAML + plain CSS**.

MVP is:

```txt
timeline
works
tv
appearances
places
themes
sources
about
```

Do not build search, map, scraping, or import tooling yet. The first win is a clean, source-backed, static index that makes Bourdain’s work easier to browse and contribute to.

