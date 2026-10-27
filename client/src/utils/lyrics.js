// The line being sung: the last one started at `time` (seconds), -1 before
// the first. A small lead so the highlight does not lag behind the voice.
export const LYRICS_LEAD_SEC = 0.3;

export function currentLineIndex(lines, time) {
  if (!Array.isArray(lines) || !Number.isFinite(time)) return -1;
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= time + LYRICS_LEAD_SEC) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
