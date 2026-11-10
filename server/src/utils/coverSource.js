// Where a cover URL comes from, judged by its host name: 'Discogs',
// 'MusicBrainz' (Cover Art Archive) or null for anything else. Only these are
// downloaded by the server, and only Discogs receives the Discogs credentials:
// a URL that merely contains "discogs.com" somewhere must not.
const SOURCES = [
  ['discogs.com', 'Discogs'],
  ['coverartarchive.org', 'MusicBrainz'],
];

export function coverSource(url) {
  let parsed;
  try {
    parsed = new URL(String(url ?? ''));
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.toLowerCase();
  const match = SOURCES.find(([domain]) => host === domain || host.endsWith(`.${domain}`));
  return match ? match[1] : null;
}
