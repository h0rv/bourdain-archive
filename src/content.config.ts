import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const statusSchema = z.enum([
  "confirmed",
  "needs-review",
  "missing-source",
  "dead-link",
  "partial",
]);
const datePrecisionSchema = z.enum(["day", "month", "year", "unknown"]);
const indexModeSchema = z.enum(["rollup", "child", "hidden"]);
const urlField = z.url().nullable().optional();
const imageField = z
  .union([z.url(), z.string().startsWith("/")])
  .nullable()
  .optional();
const contentFiles = (collection: string) =>
  glob({
    base: `./src/content/${collection}`,
    pattern: "**/*.{json,yaml,yml}",
  });

const availabilitySchema = z
  .object({
    official_url: urlField,
    reference_url: urlField,
    archive_url: urlField,
    library_url: urlField,
    audio_url: urlField,
    video_url: urlField,
    transcript_url: urlField,
    streaming_url: urlField,
    purchase_url: urlField,
  })
  .default({});

const imageUsagePolicySchema = z.enum([
  "self-hosted",
  "remote-preview",
  "link-only",
  "permission-required",
  "do-not-display",
]);

const identifiersSchema = z
  .object({
    imdb: z.string().nullable().optional(),
    tmdb: z.string().nullable().optional(),
    tvdb: z.string().nullable().optional(),
    openlibrary: z.string().nullable().optional(),
    wikidata: z.string().nullable().optional(),
    worldcat: z.string().nullable().optional(),
  })
  .default({});

const roleSchema = z.object({
  person: z.string(),
  role: z.string(),
  credited_as: z.string().optional(),
});

const commonEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.string().optional(),
  index_mode: indexModeSchema.optional(),
  parent_id: z.string().nullable().optional(),
  type: z.string(),
  date: z.string().nullable().optional(),
  date_precision: datePrecisionSchema.default("unknown"),
  summary: z.string().optional(),
  record_type: z.string().optional(),
  media_type: z.string().optional(),
  relation_to_bourdain: z.enum(["authored", "featured", "about", "reference"]).optional(),
  creator: z.array(z.string()).default([]),
  contributors: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  people: z.array(z.string()).default([]),
  places: z.array(z.string()).default([]),
  images: z.array(z.string()).default([]),
  sources: z.array(z.string()).default([]),
  related: z.array(z.string()).default([]),
  identifiers: identifiersSchema,
  roles: z.array(roleSchema).default([]),
  status: statusSchema.default("needs-review"),
  image_url: imageField,
  availability: availabilitySchema,
});

const namedEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string().optional(),
  index_mode: indexModeSchema.optional(),
  parent_id: z.string().nullable().optional(),
  type: z.string(),
  summary: z.string().optional(),
  record_type: z.string().optional(),
  media_type: z.string().optional(),
  relation_to_bourdain: z.enum(["authored", "featured", "about", "reference"]).optional(),
  creator: z.array(z.string()).default([]),
  contributors: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  people: z.array(z.string()).default([]),
  places: z.array(z.string()).default([]),
  images: z.array(z.string()).default([]),
  sources: z.array(z.string()).default([]),
  related: z.array(z.string()).default([]),
  identifiers: identifiersSchema,
  roles: z.array(roleSchema).default([]),
  status: statusSchema.default("needs-review"),
  availability: availabilitySchema.optional(),
});

export const collections = {
  works: defineCollection({
    loader: contentFiles("works"),
    schema: commonEntrySchema.extend({
      type: z.enum(["book", "article", "essay", "field-note", "comic", "film", "short-story"]),
    }),
  }),
  series: defineCollection({
    loader: contentFiles("series"),
    schema: commonEntrySchema.extend({
      type: z.enum(["show", "season", "episode", "field-note"]),
      kind: z.enum(["series", "season", "episode", "field-note"]).optional(),
      show: z.string().nullable().optional(),
      season: z.number().nullable().optional(),
      episode: z.number().nullable().optional(),
      region: z.string().nullable().optional(),
      source_url: urlField,
    }),
  }),
  appearances: defineCollection({
    loader: contentFiles("appearances"),
    schema: commonEntrySchema.extend({
      type: z.enum(["podcast", "interview", "radio", "panel", "video"]),
      host: z.string().nullable().optional(),
      duration_minutes: z.number().nullable().optional(),
    }),
  }),
  screen: defineCollection({
    loader: contentFiles("screen"),
    schema: commonEntrySchema.extend({
      type: z.enum(["film", "documentary", "television", "voice-role", "acted-role", "adaptation"]),
      role: z.string().nullable().optional(),
    }),
  }),
  literature: defineCollection({
    loader: contentFiles("literature"),
    schema: commonEntrySchema.extend({
      type: z.enum(["article", "essay", "interview", "obit", "profile", "review", "tribute"]),
      publication: z.string(),
      bucket: z.string(),
    }),
  }),
  events: defineCollection({
    loader: contentFiles("events"),
    schema: commonEntrySchema.extend({
      type: z.literal("life-event"),
    }),
  }),
  places: defineCollection({
    loader: contentFiles("places"),
    schema: namedEntrySchema.extend({ type: z.literal("place") }),
  }),
  people: defineCollection({
    loader: contentFiles("people"),
    schema: namedEntrySchema.extend({
      type: z.literal("person"),
      birth_date: z.string().nullable().optional(),
      death_date: z.string().nullable().optional(),
    }),
  }),
  images: defineCollection({
    loader: contentFiles("images"),
    schema: z.object({
      id: z.string(),
      title: z.string(),
      kind: z.literal("image").optional(),
      index_mode: indexModeSchema.optional(),
      parent_id: z.string().nullable().optional(),
      type: z.enum(["photo", "photo-essay", "portrait", "social-photo", "cover", "poster"]),
      date: z.string().nullable().optional(),
      date_precision: datePrecisionSchema.default("unknown"),
      source_url: z.url(),
      image_url: imageField,
      provider: z.string(),
      creator: z.array(z.string()).default([]),
      credit_line: z.string().optional(),
      license: z.string().optional(),
      license_url: urlField,
      rights_status: z.string(),
      usage_policy: imageUsagePolicySchema,
      alt: z.string().optional(),
      caption: z.string().optional(),
      tags: z.array(z.string()).default([]),
      people: z.array(z.string()).default([]),
      places: z.array(z.string()).default([]),
      images: z.array(z.string()).default([]),
      sources: z.array(z.string()).default([]),
      related: z.array(z.string()).default([]),
      identifiers: identifiersSchema,
      status: statusSchema.default("needs-review"),
    }),
  }),
  sources: defineCollection({
    loader: contentFiles("sources"),
    schema: z.object({
      id: z.string(),
      title: z.string(),
      kind: z.literal("source").optional(),
      index_mode: indexModeSchema.default("hidden"),
      parent_id: z.string().nullable().optional(),
      type: z.string(),
      date: z.string().nullable().optional(),
      date_precision: datePrecisionSchema.default("unknown"),
      url: z.url(),
      accessed: z.string(),
      notes: z.string().nullable().optional(),
      record_type: z.string().optional(),
      media_type: z.string().optional(),
      relation_to_bourdain: z.enum(["authored", "featured", "about", "reference"]).optional(),
      creator: z.array(z.string()).default([]),
      contributors: z.array(z.string()).default([]),
      sources: z.array(z.string()).default([]),
      related: z.array(z.string()).default([]),
      identifiers: identifiersSchema,
      status: statusSchema.default("confirmed"),
    }),
  }),
};
