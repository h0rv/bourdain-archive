import { withBase } from './site';

const collectionPaths: Record<string, string> = {
  works: 'works',
  episodes: 'tv',
  appearances: 'appearances',
  literature: 'literature',
  events: 'events',
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

export const sourceGroups = [
  { id: 'curated', label: 'Curated entries' },
  { id: 'tumblr', label: 'Tumblr' },
  { id: 'medium', label: 'Medium' },
  { id: 'list', label: 'Li.st' },
  { id: 'field-notes', label: 'Field notes' },
  { id: 'tv', label: 'TV' },
  { id: 'interviews', label: 'Interviews' },
  { id: 'articles', label: 'Articles' },
  { id: 'catalogs', label: 'Catalogs' },
  { id: 'socials', label: 'Socials' },
  { id: 'other', label: 'Other' },
] as const;

export const sourceGroupLabels = Object.fromEntries(sourceGroups.map((group) => [group.id, group.label]));

export function sourceGroupFor(data: any): string {
  const id = data.id ?? '';
  const type = data.type ?? '';
  const url = data.url ?? '';
  if (id.startsWith('tumblr-') || url.includes('anthonybourdain.tumblr.com')) return 'tumblr';
  if (id.startsWith('medium-') || url.includes('medium.com/')) return 'medium';
  if (id.startsWith('list-') || id.startsWith('bourdain-list') || url.includes('li.st/') || url.includes('bourdain.greg.technology')) return 'list';
  if (type === 'field-note' || (url.includes('explorepartsunknown.com') && url.includes('field-notes'))) return 'field-notes';
  if (['episode-guide', 'official-show-page', 'official-video', 'video-series', 'dead-official-page', 'official-archive', 'dataset', 'fan-index', 'transcript-index'].includes(type)) return 'tv';
  if (type.includes('interview') || ['podcast', 'panel', 'radio-archive', 'audio-archive', 'audio-interview'].includes(type)) return 'interviews';
  if (['article', 'essay', 'profile', 'review', 'obituary'].includes(type)) return 'articles';
  if (type.includes('awards') || type.includes('library') || type.includes('catalog') || type.includes('authority') || type === 'publisher-page') return 'catalogs';
  if (type === 'social-profile') return 'socials';
  return 'other';
}

const monthNumbers: Record<string, string> = {
  january: '01',
  february: '02',
  march: '03',
  april: '04',
  may: '05',
  june: '06',
  july: '07',
  august: '08',
  september: '09',
  october: '10',
  november: '11',
  december: '12',
};

export function sourceTimelineDate(data: any): { date?: string; precision: string } {
  if (data.date) return { date: data.date, precision: data.date_precision ?? 'unknown' };

  const notes = data.notes ?? '';
  const isoPageDate = notes.match(/Page date:\s*(\d{4}-\d{2}-\d{2})/i);
  if (isoPageDate) return { date: isoPageDate[1], precision: 'day' };

  const publishedDate = notes.match(/Published\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/i);
  if (publishedDate) {
    const month = monthNumbers[publishedDate[1].toLowerCase()];
    if (month) return { date: `${publishedDate[3]}-${month}-${publishedDate[2].padStart(2, '0')}`, precision: 'day' };
  }

  return { date: undefined, precision: 'unknown' };
}

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
    data.url ??
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

export function siteAssetUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  return url.startsWith('/') ? withBase(url) : url;
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
    image: siteAssetUrl(data.image_url) ?? urlPreview.image,
    favicon: urlPreview.favicon,
    archive: urlPreview.archive,
    label: data.publication ?? urlPreview.title ?? urlPreview.host ?? data.title ?? formatType(data.type),
  };
}
