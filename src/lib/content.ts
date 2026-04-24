import { withBase } from './site';

const collectionPaths: Record<string, string> = {
  works: 'works',
  episodes: 'tv',
  appearances: 'appearances',
  places: 'places',
  sources: 'sources',
};

const availabilityFields = [
  ['official_url', 'Official'],
  ['archive_url', 'Archive'],
  ['library_url', 'Library'],
  ['audio_url', 'Audio'],
  ['video_url', 'Video'],
  ['transcript_url', 'Transcript'],
  ['streaming_url', 'Streaming'],
  ['purchase_url', 'Purchase'],
] as const;

export function entryTitle(entry: any): string {
  return entry.data.title ?? entry.data.name ?? entry.data.id;
}

export function entryHref(collection: string, id: string): string {
  const path = collectionPaths[collection] ?? collection;
  return withBase(`/${path}/${id}/`);
}

export function formatType(type: string): string {
  return type.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function statusClass(status: string): string {
  return `status-${status}`;
}

export function formatDate(date?: string | null, precision?: string): string {
  if (!date) return 'Undated';
  if (precision === 'year') return date.slice(0, 4);
  if (precision === 'month') return date.slice(0, 7);
  return date;
}

export function sortByDateDesc(a: any, b: any): number {
  const left = a.data.date ?? '';
  const right = b.data.date ?? '';
  return right.localeCompare(left);
}

export function availabilityBadges(availability?: Record<string, string | null | undefined>) {
  const badges = availabilityFields
    .map(([field, label]) => ({ field, label, url: availability?.[field] }))
    .filter((badge) => Boolean(badge.url));

  return badges.length > 0 ? badges : [{ field: 'unknown', label: 'Unknown', url: undefined }];
}

export function findByDataId(entries: any[], id: string) {
  return entries.find((entry) => entry.data.id === id);
}
