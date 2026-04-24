import { withBase } from './site';

const collectionPaths: Record<string, string> = {
  works: 'works',
  episodes: 'tv',
  appearances: 'appearances',
  literature: 'literature',
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

export function primaryAvailabilityUrl(data: any): string | undefined {
  const availability = data.availability ?? {};
  return (
    availability.video_url ??
    availability.audio_url ??
    availability.official_url ??
    availability.streaming_url ??
    availability.purchase_url ??
    availability.library_url ??
    availability.archive_url ??
    availability.transcript_url ??
    undefined
  );
}

export function hostnameForUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

export function youtubeId(url?: string | null): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') return parsed.pathname.split('/').filter(Boolean)[0];
    if (host.endsWith('youtube.com')) {
      if (parsed.searchParams.get('v')) return parsed.searchParams.get('v') ?? undefined;
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (['embed', 'shorts', 'live'].includes(parts[0])) return parts[1];
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function archiveTargetsForUrl(url?: string | null) {
  if (!url) return undefined;
  const encoded = encodeURI(url);
  return {
    latest_url: `https://web.archive.org/web/2/${encoded}`,
    calendar_url: `https://web.archive.org/web/*/${encoded}`,
    save_url: `https://web.archive.org/save/${encoded}`,
  };
}

export function previewForUrl(url?: string | null, cache?: Record<string, any>) {
  const host = hostnameForUrl(url);
  const videoId = youtubeId(url);
  const cached = url ? cache?.[url] : undefined;
  return {
    host,
    title: cached?.title,
    description: cached?.description,
    image: videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : cached?.image,
    favicon: host ? `https://www.google.com/s2/favicons?domain=${host}&sz=128` : undefined,
    archive: archiveTargetsForUrl(url),
  };
}

export function previewForEntry(entry: any, cache?: Record<string, any>) {
  const data = entry.data ?? entry;
  const url = primaryAvailabilityUrl(data);
  const urlPreview = previewForUrl(url, cache);
  return {
    url,
    host: urlPreview.host,
    title: urlPreview.title,
    description: urlPreview.description,
    image: data.image_url ?? urlPreview.image,
    favicon: urlPreview.favicon,
    archive: urlPreview.archive,
    label: data.publication ?? urlPreview.title ?? urlPreview.host ?? formatType(data.type),
  };
}
