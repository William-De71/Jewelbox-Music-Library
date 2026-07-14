import { createContext } from 'preact';
import { useState, useEffect, useRef, useContext, useCallback } from 'preact/hooks';
import { api } from '../api/client.js';

const PlayerContext = createContext(null);

function buildQueue(album) {
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
    }));
}

export function PlayerProvider({ children }) {
  const audioRef = useRef(null);
  const [queue, setQueue] = useState([]);
  const [index, setIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(() => {
    const saved = parseFloat(localStorage.getItem('jewelbox-volume'));
    return Number.isFinite(saved) && saved >= 0 && saved <= 1 ? saved : 1;
  });

  const queueRef = useRef(queue);
  const indexRef = useRef(index);
  queueRef.current = queue;
  indexRef.current = index;

  if (!audioRef.current && typeof Audio !== 'undefined') {
    audioRef.current = new Audio();
  }

  const current = index >= 0 ? queue[index] ?? null : null;

  const playAt = useCallback((newQueue, newIndex) => {
    const audio = audioRef.current;
    const track = newQueue[newIndex];
    if (!audio || !track) return;
    setQueue(newQueue);
    setIndex(newIndex);
    setCurrentTime(0);
    setDuration(0);
    audio.src = api.trackStreamUrl(track.id);
    audio.play().catch(() => setPlaying(false));
  }, []);

  const playAlbum = useCallback((album, startIndex = 0) => {
    const newQueue = buildQueue(album);
    if (newQueue.length === 0) return;
    playAt(newQueue, Math.min(startIndex, newQueue.length - 1));
  }, [playAt]);

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
  }, [playAt]);

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

  const seek = useCallback((seconds) => {
    const audio = audioRef.current;
    if (audio && Number.isFinite(seconds)) audio.currentTime = seconds;
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
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.volume = volume;
  }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onLoadedMetadata = () => setDuration(audio.duration || 0);
    const onEnded = () => {
      const q = queueRef.current;
      const i = indexRef.current;
      if (i + 1 < q.length) playAt(q, i + 1);
      else setPlaying(false);
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
    queue, index, current, playing, currentTime, duration, volume,
    playAlbum, playAlbumById, toggle, next, prev, seek, setVolume, close,
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
