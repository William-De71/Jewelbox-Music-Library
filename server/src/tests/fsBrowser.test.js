import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveInRoots, listDirectory, parentWithinRoots, getBrowseRoots } from '../utils/fsBrowser.js';

describe('fsBrowser', () => {
  let tmp;
  let roots;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jb-browse-'));
    fs.mkdirSync(path.join(tmp, 'music/Artist/Album'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'music/.hidden'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'outside'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'music/Artist/Album/01.mp3'), '');
    fs.writeFileSync(path.join(tmp, 'music/Artist/Album/02.flac'), '');
    fs.writeFileSync(path.join(tmp, 'music/Artist/Album/cover.jpg'), '');
    fs.symlinkSync(path.join(tmp, 'outside'), path.join(tmp, 'music/escape'));
    roots = [path.join(tmp, 'music')];
  });

  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  describe('resolveInRoots', () => {
    it('accepts a root itself and paths under it', () => {
      expect(resolveInRoots(path.join(tmp, 'music'), roots)).toBe(fs.realpathSync(path.join(tmp, 'music')));
      expect(resolveInRoots(path.join(tmp, 'music/Artist'), roots)).toBeTruthy();
    });

    it('rejects paths outside every root', () => {
      expect(resolveInRoots(path.join(tmp, 'outside'), roots)).toBeNull();
      expect(resolveInRoots('/etc', roots)).toBeNull();
    });

    it('rejects traversal through ..', () => {
      expect(resolveInRoots(path.join(tmp, 'music/../outside'), roots)).toBeNull();
    });

    it('rejects a symlink escaping the root', () => {
      expect(resolveInRoots(path.join(tmp, 'music/escape'), roots)).toBeNull();
    });

    it('rejects dotfile directories even inside a root', () => {
      expect(resolveInRoots(path.join(tmp, 'music/.hidden'), roots)).toBeNull();
    });

    it('rejects a non-existent path', () => {
      expect(resolveInRoots(path.join(tmp, 'music/nope'), roots)).toBeNull();
    });
  });

  describe('listDirectory', () => {
    it('counts audio files and lists sub-folders with absolute paths', async () => {
      const { folders, audioFiles } = await listDirectory(path.join(tmp, 'music/Artist/Album'));
      expect(audioFiles).toBe(2); // mp3 + flac, not the jpg
      expect(folders).toEqual([]);

      const artist = await listDirectory(path.join(tmp, 'music/Artist'));
      expect(artist.folders).toHaveLength(1);
      expect(artist.folders[0].name).toBe('Album');
      expect(artist.folders[0].path).toBe(path.join(tmp, 'music/Artist/Album'));
      expect(artist.folders[0].audio_files).toBe(2);
    });

    it('hides dotfile folders from the listing', async () => {
      const { folders } = await listDirectory(path.join(tmp, 'music'));
      expect(folders.map(f => f.name)).not.toContain('.hidden');
    });
  });

  describe('parentWithinRoots', () => {
    it('returns null at a root', () => {
      expect(parentWithinRoots(path.join(tmp, 'music'), roots)).toBeNull();
    });

    it('returns the parent inside a root', () => {
      expect(parentWithinRoots(path.join(tmp, 'music/Artist'), roots)).toBe(path.join(tmp, 'music'));
    });
  });

  describe('getBrowseRoots', () => {
    it('honours JEWELBOX_BROWSE_ROOTS and skips missing roots', () => {
      const prev = process.env.JEWELBOX_BROWSE_ROOTS;
      process.env.JEWELBOX_BROWSE_ROOTS = `${path.join(tmp, 'music')}:/does/not/exist`;
      expect(getBrowseRoots()).toEqual([fs.realpathSync(path.join(tmp, 'music'))]);
      if (prev === undefined) delete process.env.JEWELBOX_BROWSE_ROOTS;
      else process.env.JEWELBOX_BROWSE_ROOTS = prev;
    });
  });
});
