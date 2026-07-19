import { createContext } from 'preact';
import { useState, useEffect, useRef, useContext, useCallback } from 'preact/hooks';
import { api } from '../api/client.js';
import { getDeviceLabel } from '../utils/deviceId.js';

const PlayerContext = createContext(null);

// Turns an album payload into queue-shaped items. Exported so callers can feed
// addToQueue/playNext without duplicating the mapping.
export function buildQueue(album) {
  return (album.tracks || [])
    .filter(t => t.has_file)
    .map(t => ({
      id: t.id,
      position: t.position,
      title: t.title,
      duration: t.duration,
      album_id: album.id,
      album_title: album.title,
      artist_name: album.artist?.name || '',
      cover_url: album.cover_url || null,
      is_favorite: Boolean(t.is_favorite),
    }));
}

// Fisher-Yates on a copy
function shuffled(arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function PlayerProvider({ children }) {
  const audioRef = useRef(null);
  const [queue, setQueue] = useState([]);
  const [index, setIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [volume, setVolumeState] = useState(() => {
    const saved = parseFloat(localStorage.getItem('jewelbox-volume'));
    return Number.isFinite(saved) && saved >= 0 && saved <= 1 ? saved : 1;
  });
  const [repeat, setRepeat] = useState(() => {
    const saved = localStorage.getItem('jewelbox-repeat');
    return ['off', 'all', 'one'].includes(saved) ? saved : 'off';
  });
  const [shuffle, setShuffle] = useState(() => localStorage.getItem('jewelbox-shuffle') === '1');
  const [dynamicMix, setDynamicMix] = useState(false);

  const queueRef = useRef(queue);
  const indexRef = useRef(index);
  queueRef.current = queue;
  indexRef.current = index;

  // The audio event handlers are bound once ([playAt] effect): they must read
  // these refs, never the state values captured at bind time.
  const repeatRef = useRef(repeat);
  const shuffleRef = useRef(shuffle);
  const dynamicMixRef = useRef(false);
  repeatRef.current = repeat;
  shuffleRef.current = shuffle;
  const originalQueueRef = useRef([]); // pre-shuffle order, restored when shuffle is turned off

  // Last.fm scrobbling state for the current playback (reset on every track change)
  const scrobbleRef = useRef({ trackId: null, startedAt: 0, played: 0, lastTime: 0, scrobbled: false });

  if (!audioRef.current && typeof Audio !== 'undefined') {
    audioRef.current = new Audio();
  }

  const current = index >= 0 ? queue[index] ?? null : null;

  // Server sync. Every write is best-effort: losing the server must never take
  // playback down with it, so failures are swallowed like toggleFavorite does.
  const restoredRef = useRef(false); // guards against saving before restore ran
  const lastStateWriteRef = useRef(0);

  const pushQueue = useCallback((tracks, currentIndex) => {
    if (!restoredRef.current) return;
    api.saveQueue(tracks.map(t => t.id), {
      currentIndex,
      positionSec: 0,
      label: getDeviceLabel(),
    }).catch(() => {});
  }, []);

  // Throttled: 'timeupdate' fires ~4x/second and would hammer SQLite.
  const pushState = useCallback((currentIndex, positionSec, { force = false } = {}) => {
    if (!restoredRef.current) return;
    const now = Date.now();
    if (!force && now - lastStateWriteRef.current < 10000) return;
    lastStateWriteRef.current = now;
    api.updateQueueState(currentIndex, positionSec).catch(() => {});
  }, []);

  // Applies a new queue locally, keeping the pre-shuffle order in sync so that
  // turning shuffle off later cannot resurrect tracks the user removed.
  const applyQueue = useCallback((newQueue, newIndex, { syncOriginal = true } = {}) => {
    if (syncOriginal) {
      const ids = new Set(newQueue.map(t => t.id));
      const kept = originalQueueRef.current.filter(t => ids.has(t.id));
      const knownIds = new Set(kept.map(t => t.id));
      originalQueueRef.current = [...kept, ...newQueue.filter(t => !knownIds.has(t.id))];
    }
    queueRef.current = newQueue;
    indexRef.current = newIndex;
    setQueue(newQueue);
    setIndex(newIndex);
  }, []);

  const playAt = useCallback((newQueue, newIndex) => {
    const audio = audioRef.current;
    const track = newQueue[newIndex];
    if (!audio || !track) return;
    setQueue(newQueue);
    setIndex(newIndex);
    setCurrentTime(0);
    setDuration(0);
    scrobbleRef.current = {
      trackId: track.id,
      startedAt: Math.floor(Date.now() / 1000),
      played: 0,
      lastTime: 0,
      scrobbled: false,
    };
    api.lastfmNowPlaying(track.id).catch(() => {});
    audio.src = api.trackStreamUrl(track.id);
    audio.play().catch(() => setPlaying(false));
  }, []);

  // Replays the current track from the start (repeat one). Full scrobble reset:
  // Last.fm accepts re-scrobbles of a replayed track, and local play counting follows.
  const replayCurrent = useCallback(() => {
    const audio = audioRef.current;
    const track = queueRef.current[indexRef.current];
    if (!audio || !track) return;
    scrobbleRef.current = {
      trackId: track.id,
      startedAt: Math.floor(Date.now() / 1000),
      played: 0,
      lastTime: 0,
      scrobbled: false,
    };
    api.lastfmNowPlaying(track.id).catch(() => {});
    audio.currentTime = 0;
    audio.play().catch(() => setPlaying(false));
  }, []);

  // Restarts the queue from the top (repeat all), reshuffling when shuffle is on.
  const wrapAround = useCallback(() => {
    const q = shuffleRef.current ? shuffled(queueRef.current) : queueRef.current;
    playAt(q, 0);
  }, [playAt]);

  // Mirrors a server-side dynamic mix update locally: drops `removedId` from
  // the queue and appends the server's replacements at the bottom.
  const syncDynamicQueue = (removedId, serverTracks) => {
    const kept = queueRef.current.filter(t => t.id !== removedId);
    const keptIds = new Set(kept.map(t => t.id));
    const appended = (serverTracks || []).filter(t => t.has_file !== false && !keptIds.has(t.id));
    originalQueueRef.current = [
      ...originalQueueRef.current.filter(t => t.id !== removedId),
      ...appended,
    ];
    return { kept, appended, newQueue: [...kept, ...appended] };
  };

  // Dynamic mix: a fully played track leaves the server-side list; mirror
  // that locally by dropping it and appending the server's replacements at the
  // bottom. With `resume`, the queue had run dry: chain onto the first one.
  const consumeDynamicMix = useCallback((endedId, resume) => {
    api.dynamicMixPlayed(endedId)
      .then((res) => {
        if (!dynamicMixRef.current) return; // another queue took over meanwhile
        const q = queueRef.current;
        const { kept, appended, newQueue } = syncDynamicQueue(endedId, res.tracks);
        if (!newQueue.length) return;
        if (resume) {
          if (appended.length) playAt(newQueue, kept.length);
        } else {
          const playingId = q[indexRef.current]?.id;
          const newIndex = Math.max(0, newQueue.findIndex(t => t.id === playingId));
          queueRef.current = newQueue;
          indexRef.current = newIndex;
          setQueue(newQueue);
          setIndex(newIndex);
        }
      })
      .catch(() => {}); // offline: the local queue simply keeps the track
  }, [playAt]);

  // Manual removal of a disliked track from the dynamic mix. When the mix is
  // playing, the queue follows; removing the current track skips to the next.
  // Returns the fresh server list so callers can update their own display.
  const removeDynamicMixTrack = useCallback(async (trackId) => {
    const res = await api.dynamicMixRemove(trackId);
    if (dynamicMixRef.current) {
      const q = queueRef.current;
      const i = indexRef.current;
      const wasCurrent = q[i]?.id === trackId;
      const { newQueue } = syncDynamicQueue(trackId, res.tracks);
      if (!newQueue.length) {
        close();
      } else if (wasCurrent) {
        playAt(newQueue, Math.min(i, newQueue.length - 1));
      } else {
        const playingId = q[i]?.id;
        const newIndex = Math.max(0, newQueue.findIndex(t => t.id === playingId));
        queueRef.current = newQueue;
        indexRef.current = newIndex;
        setQueue(newQueue);
        setIndex(newIndex);
      }
    }
    return res.tracks;
  }, [playAt]);

  // Full refresh: the server draws a brand-new mix. When the mix is playing,
  // the current track keeps playing and the new draw queues up behind it.
  // Returns the fresh server list so callers can update their own display.
  const refreshDynamicMix = useCallback(async () => {
    const res = await api.dynamicMixRefresh();
    if (dynamicMixRef.current) {
      const fresh = (res.tracks || []).filter(t => t.has_file !== false);
      const cur = queueRef.current[indexRef.current];
      const newQueue = cur ? [cur, ...fresh.filter(t => t.id !== cur.id)] : fresh;
      originalQueueRef.current = newQueue;
      queueRef.current = newQueue;
      indexRef.current = newQueue.length ? 0 : -1;
      setQueue(newQueue);
      setIndex(indexRef.current);
    }
    return res.tracks;
  }, []);

  // tracks must be queue-shaped items ({id, title, album_id, artist_name, cover_url, ...})
  const playTracks = useCallback((tracks, startIndex = 0, { dynamic = false } = {}) => {
    const base = (tracks || []).filter(t => t.has_file !== false);
    if (base.length === 0) return;
    originalQueueRef.current = base;
    setDynamicMix(dynamic);
    dynamicMixRef.current = dynamic;
    let newQueue = base;
    let newIndex = Math.min(startIndex, base.length - 1);
    if (shuffleRef.current) {
      // Requested track first, the rest shuffled behind it
      newQueue = [base[newIndex], ...shuffled(base.filter((_, k) => k !== newIndex))];
      newIndex = 0;
    }
    playAt(newQueue, newIndex);
    pushQueue(newQueue, newIndex);
  }, [playAt, pushQueue]);

  const playDynamicMix = useCallback(async () => {
    const res = await api.getSmartPlaylist('dynamic_mix');
    playTracks(res.tracks, 0, { dynamic: true });
  }, [playTracks]);

  const playAlbum = useCallback((album, startIndex = 0) => {
    playTracks(buildQueue(album), startIndex);
  }, [playTracks]);

  const playAlbumById = useCallback(async (albumId, startIndex = 0) => {
    const album = await api.getAlbum(albumId);
    playAlbum(album, startIndex);
  }, [playAlbum]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || indexRef.current < 0) return;
    if (audio.paused) audio.play().catch(() => setPlaying(false));
    else audio.pause();
  }, []);

  const next = useCallback(() => {
    const q = queueRef.current;
    const i = indexRef.current;
    if (i + 1 < q.length) playAt(q, i + 1);
    else if (!dynamicMixRef.current && repeatRef.current === 'all' && q.length) wrapAround();
  }, [playAt, wrapAround]);

  const prev = useCallback(() => {
    const audio = audioRef.current;
    const q = queueRef.current;
    const i = indexRef.current;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
    } else if (i > 0) {
      playAt(q, i - 1);
    } else if (audio) {
      audio.currentTime = 0;
    }
  }, [playAt]);

  const jumpTo = useCallback((i) => {
    const q = queueRef.current;
    if (i >= 0 && i < q.length) playAt(q, i);
  }, [playAt]);

  const seek = useCallback((seconds) => {
    const audio = audioRef.current;
    if (audio && Number.isFinite(seconds)) audio.currentTime = seconds;
  }, []);

  const cycleRepeat = useCallback(() => {
    setRepeat((r) => {
      const nextMode = { off: 'all', all: 'one', one: 'off' }[r];
      repeatRef.current = nextMode;
      localStorage.setItem('jewelbox-repeat', nextMode);
      return nextMode;
    });
  }, []);

  const toggleShuffle = useCallback(() => {
    const on = !shuffleRef.current;
    shuffleRef.current = on;
    setShuffle(on);
    localStorage.setItem('jewelbox-shuffle', on ? '1' : '0');

    const q = queueRef.current;
    const i = indexRef.current;
    if (i < 0 || !q.length) return; // nothing playing: just a preference

    const currentTrack = q[i];
    let newQueue;
    let newIndex;
    if (on) {
      newQueue = [currentTrack, ...shuffled(q.filter((_, k) => k !== i))];
      newIndex = 0;
    } else {
      newQueue = originalQueueRef.current;
      // By id, not by reference: toggleFavorite recreates queue objects
      newIndex = Math.max(0, newQueue.findIndex(t => t.id === currentTrack.id));
    }
    // Sync refs immediately: an 'ended' event may fire before the re-render
    queueRef.current = newQueue;
    indexRef.current = newIndex;
    setQueue(newQueue);
    setIndex(newIndex);
    // Audio and scrobble state untouched: playback continues seamlessly
  }, []);

  const toggleFavorite = useCallback((trackId, isFavorite) => {
    const apply = (v) => {
      const update = (list) => list.map(t => (t.id === trackId ? { ...t, is_favorite: v } : t));
      originalQueueRef.current = update(originalQueueRef.current);
      const newQueue = update(queueRef.current);
      queueRef.current = newQueue;
      setQueue(newQueue);
    };
    apply(isFavorite); // optimistic
    return api.setTrackFavorite(trackId, isFavorite).catch(() => apply(!isFavorite));
  }, []);

  // ── Queue editing ───────────────────────────────────────────────────────────
  // All of these apply locally first, then tell the server. Track objects must
  // be queue-shaped ({id, title, album_id, artist_name, cover_url, ...}).

  // Appends at the end of the queue.
  const addToQueue = useCallback((tracks) => {
    const additions = (Array.isArray(tracks) ? tracks : [tracks]).filter(t => t?.has_file !== false);
    if (!additions.length) return;
    const newQueue = [...queueRef.current, ...additions];
    applyQueue(newQueue, indexRef.current);
    pushQueue(newQueue, indexRef.current);
  }, [applyQueue, pushQueue]);

  // Inserts right behind the current track.
  const playNext = useCallback((tracks) => {
    const additions = (Array.isArray(tracks) ? tracks : [tracks]).filter(t => t?.has_file !== false);
    if (!additions.length) return;
    const q = queueRef.current;
    const i = indexRef.current;
    const at = i < 0 ? q.length : i + 1;
    const newQueue = [...q.slice(0, at), ...additions, ...q.slice(at)];
    applyQueue(newQueue, i);
    pushQueue(newQueue, i);
  }, [applyQueue, pushQueue]);

  // Removing the playing track skips to whatever takes its place.
  const removeFromQueue = useCallback((position) => {
    const q = queueRef.current;
    const i = indexRef.current;
    if (position < 0 || position >= q.length) return;

    const newQueue = q.filter((_, k) => k !== position);
    if (!newQueue.length) return close();

    if (position === i) {
      const nextIndex = Math.min(i, newQueue.length - 1);
      applyQueue(newQueue, nextIndex);
      playAt(newQueue, nextIndex);
    } else {
      applyQueue(newQueue, position < i ? i - 1 : i);
    }
    pushQueue(newQueue, indexRef.current);
  }, [applyQueue, playAt, pushQueue]);

  // Drag & drop reordering; the playing track keeps playing.
  const moveInQueue = useCallback((from, to) => {
    const q = queueRef.current;
    if (from === to || from < 0 || to < 0 || from >= q.length || to >= q.length) return;

    const i = indexRef.current;
    const playing = i >= 0 ? q[i] : null;
    const newQueue = [...q];
    const [moved] = newQueue.splice(from, 1);
    newQueue.splice(to, 0, moved);
    // Track the playing entry by object identity: duplicate ids are legal in a
    // queue, so indexOf on the id would follow the wrong copy.
    const newIndex = playing ? newQueue.indexOf(playing) : -1;

    applyQueue(newQueue, newIndex);
    pushQueue(newQueue, indexRef.current);
  }, [applyQueue, pushQueue]);

  const clearQueue = useCallback(() => {
    close();
    api.queueClear().catch(() => {});
  }, []);

  const setVolume = useCallback((v) => {
    const clamped = Math.min(1, Math.max(0, v));
    setVolumeState(clamped);
    localStorage.setItem('jewelbox-volume', String(clamped));
  }, []);

  const close = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    setQueue([]);
    setIndex(-1);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setExpanded(false);
    setDynamicMix(false);
    dynamicMixRef.current = false;
    originalQueueRef.current = [];
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.volume = volume;
  }, [volume]);

  // Restore the queue this device left behind. Deliberately does not call
  // playAt: browsers block autoplay anyway, and resuming audio on page load
  // without a gesture would be obnoxious. The track is armed, paused, at the
  // saved offset — pressing play picks up where it stopped.
  useEffect(() => {
    let cancelled = false;
    api.getQueue()
      .then((saved) => {
        if (cancelled) return;
        const tracks = (saved?.tracks || []).filter(t => t.has_file !== false);
        if (!tracks.length) return;

        const i = saved.current_index >= 0 && saved.current_index < tracks.length
          ? saved.current_index
          : 0;
        originalQueueRef.current = tracks;
        queueRef.current = tracks;
        indexRef.current = i;
        setQueue(tracks);
        setIndex(i);

        const audio = audioRef.current;
        if (audio) {
          audio.src = api.trackStreamUrl(tracks[i].id);
          const offset = Number(saved.position_sec) || 0;
          if (offset > 0) {
            const seekOnce = () => {
              audio.currentTime = offset;
              audio.removeEventListener('loadedmetadata', seekOnce);
            };
            audio.addEventListener('loadedmetadata', seekOnce);
          }
        }
      })
      .catch(() => {}) // offline or no server: start with an empty player
      .finally(() => { restoredRef.current = true; });
    return () => { cancelled = true; };
  }, []);

  // Persist progress: on every track change, and throttled while playing.
  useEffect(() => {
    if (index < 0) return;
    pushState(index, currentTime, { force: true });
  }, [index, pushState]);

  useEffect(() => {
    if (index < 0 || !playing) return;
    pushState(index, currentTime);
  }, [currentTime, index, playing, pushState]);

  useEffect(() => {
    if (index < 0 || playing) return;
    pushState(index, currentTime, { force: true }); // pause: checkpoint now
  }, [playing, pushState]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      // Last.fm rule: track >= 30s, played half of it or 4 minutes
      const s = scrobbleRef.current;
      if (s.trackId != null) {
        const dt = audio.currentTime - s.lastTime;
        if (dt > 0 && dt < 2) s.played += dt; // ignore seeks
        s.lastTime = audio.currentTime;
        const dur = audio.duration;
        if (!s.scrobbled && Number.isFinite(dur) && dur >= 30 && (s.played >= dur / 2 || s.played >= 240)) {
          s.scrobbled = true;
          api.trackPlayed(s.trackId).catch(() => {}); // local play counting, independent of Last.fm
          api.lastfmScrobble(s.trackId, s.startedAt).catch(() => {});
        }
      }
    };
    const onLoadedMetadata = () => setDuration(audio.duration || 0);
    const onEnded = () => {
      // repeat one: the track loops on purpose, keep it in the mix list
      if (repeatRef.current === 'one') return replayCurrent();
      const q = queueRef.current;
      const i = indexRef.current;
      const ended = q[i];
      const hasNext = i + 1 < q.length;
      if (hasNext) playAt(q, i + 1);
      else if (!dynamicMixRef.current && repeatRef.current === 'all' && q.length) wrapAround();
      else setPlaying(false);
      if (dynamicMixRef.current && ended) consumeDynamicMix(ended.id, !hasNext);
    };
    const onError = () => setPlaying(false);

    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
    };
  }, [playAt]);

  // MediaSession: lock-screen / notification controls (Android, GNOME)
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    if (!current) {
      navigator.mediaSession.metadata = null;
      return;
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title,
      artist: current.artist_name,
      album: current.album_title,
      artwork: current.cover_url ? [{ src: current.cover_url, sizes: '512x512' }] : [],
    });
    navigator.mediaSession.setActionHandler('play', toggle);
    navigator.mediaSession.setActionHandler('pause', toggle);
    navigator.mediaSession.setActionHandler('previoustrack', prev);
    navigator.mediaSession.setActionHandler('nexttrack', next);
    navigator.mediaSession.setActionHandler('seekto', (details) => seek(details.seekTime));
  }, [current, toggle, prev, next, seek]);

  useEffect(() => {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    if (!current || !Number.isFinite(duration) || duration <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        position: Math.min(currentTime, duration),
        playbackRate: 1,
      });
    } catch { /* stale position values are harmless */ }
  }, [current, currentTime, duration]);

  // Lets the layout reserve space for the player bar.
  useEffect(() => {
    document.body.classList.toggle('player-open', Boolean(current));
    return () => document.body.classList.remove('player-open');
  }, [current]);

  const value = {
    queue, index, current, playing, currentTime, duration, volume, expanded,
    repeat, shuffle, dynamicMix,
    playTracks, playAlbum, playAlbumById, playDynamicMix,
    removeDynamicMixTrack, refreshDynamicMix,
    toggle, next, prev, seek, setVolume, close, setExpanded, jumpTo,
    cycleRepeat, toggleShuffle, toggleFavorite,
    addToQueue, playNext, removeFromQueue, moveInQueue, clearQueue,
  };

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer() {
  const context = useContext(PlayerContext);
  if (!context) {
    throw new Error('usePlayer must be used within PlayerProvider');
  }
  return context;
}
