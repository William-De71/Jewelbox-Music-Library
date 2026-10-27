// Sleep timer: playback pauses after a delay, fading out over the last
// seconds, or at the end of the current track (no fade: the track ends by
// itself). Same rules in the desktop and Android players, and the remote
// controller (Gladys) can set it: command sleep_timer, see
// server/src/utils/remote.js.

export const SLEEP_TIMER_MINUTES = [15, 30, 45, 60, 90];
export const SLEEP_FADE_MS = 10000;

// timer: null | { endsAt } (epoch ms) | { endOfTrack: true }
export function sleepTimerFrom(command, now) {
  if (command?.end_of_track) return { endOfTrack: true };
  const minutes = Number(command?.minutes);
  return Number.isFinite(minutes) && minutes > 0 ? { endsAt: now + minutes * 60000 } : null;
}

// Volume multiplier while the timer runs out: 1, then down to 0 over the fade.
export function sleepFadeFactor(timer, now) {
  if (!timer?.endsAt) return 1;
  const left = timer.endsAt - now;
  if (left >= SLEEP_FADE_MS) return 1;
  return Math.max(0, left / SLEEP_FADE_MS);
}

// What the live state reports to the controllers.
export function sleepTimerLive(timer) {
  if (!timer) return null;
  if (timer.endOfTrack) return { end_of_track: true };
  return { ends_at: new Date(timer.endsAt).toISOString() };
}
