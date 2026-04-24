import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const statusSchema = z.enum(['confirmed', 'needs-review', 'missing-source', 'dead-link', 'partial']);
const datePrecisionSchema = z.enum(['day', 'month', 'year', 'unknown']);
const urlField = z.url().nullable().optional();
const imageField = z.union([z.url(), z.string().startsWith('/')]).nullable().optional();
const contentFiles = (collection: string) => glob({ base: `./src/content/${collection}`, pattern: '**/*.{json,yaml,yml}' });

const availabilitySchema = z.object({
  official_url: urlField,
  archive_url: urlField,
  library_url: urlField,
  audio_url: urlField,
  video_url: urlField,
  transcript_url: urlField,
  streaming_url: urlField,
  purchase_url: urlField,
}).default({});

const commonEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  type: z.string(),
  date: z.string().nullable().optional(),
  date_precision: datePrecisionSchema.default('unknown'),
  summary: z.string(),
  tags: z.array(z.string()).default([]),
  people: z.array(z.string()).default([]),
  places: z.array(z.string()).default([]),
  sources: z.array(z.string()).default([]),
  related: z.array(z.string()).default([]),
  status: statusSchema.default('needs-review'),
  image_url: imageField,
  availability: availabilitySchema,
});

const namedEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  summary: z.string(),
  tags: z.array(z.string()).default([]),
  people: z.array(z.string()).default([]),
  places: z.array(z.string()).default([]),
  sources: z.array(z.string()).default([]),
  related: z.array(z.string()).default([]),
  status: statusSchema.default('needs-review'),
  availability: availabilitySchema.optional(),
});

export const collections = {
  works: defineCollection({
    loader: contentFiles('works'),
    schema: commonEntrySchema.extend({
      type: z.enum(['book', 'article', 'essay', 'field-note', 'comic']),
    }),
  }),
  episodes: defineCollection({
    loader: contentFiles('episodes'),
    schema: commonEntrySchema.extend({
      type: z.enum(['show', 'episode', 'video']),
      show: z.string().nullable().optional(),
      season: z.number().nullable().optional(),
      episode: z.number().nullable().optional(),
    }),
  }),
  appearances: defineCollection({
    loader: contentFiles('appearances'),
    schema: commonEntrySchema.extend({
      type: z.enum(['podcast', 'interview', 'radio', 'panel', 'video']),
      host: z.string().nullable().optional(),
      duration_minutes: z.number().nullable().optional(),
    }),
  }),
  literature: defineCollection({
    loader: contentFiles('literature'),
    schema: commonEntrySchema.extend({
      type: z.enum(['article', 'essay', 'interview', 'obit', 'profile', 'review', 'tribute']),
      publication: z.string(),
      bucket: z.string(),
    }),
  }),
  events: defineCollection({
    loader: contentFiles('events'),
    schema: commonEntrySchema.extend({
      type: z.literal('life-event'),
    }),
  }),
  places: defineCollection({
    loader: contentFiles('places'),
    schema: namedEntrySchema.extend({ type: z.literal('place') }),
  }),
  people: defineCollection({
    loader: contentFiles('people'),
    schema: namedEntrySchema.extend({
      type: z.literal('person'),
      birth_date: z.string().nullable().optional(),
      death_date: z.string().nullable().optional(),
    }),
  }),
  sources: defineCollection({
    loader: contentFiles('sources'),
    schema: z.object({
      id: z.string(),
      title: z.string(),
      type: z.string(),
      date: z.string().nullable().optional(),
      date_precision: datePrecisionSchema.default('unknown'),
      url: z.url(),
      accessed: z.string(),
      notes: z.string().nullable().optional(),
    }),
  }),
};
