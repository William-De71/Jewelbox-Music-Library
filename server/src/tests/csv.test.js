import { describe, it, expect } from 'vitest';
import { parseCsv } from '../utils/csv.js';

describe('parseCsv', () => {
  it('reads plain and quoted cells', () => {
    expect(parseCsv('title,artist\n"The Bends","Radiohead"')).toEqual([
      ['title', 'artist'],
      ['The Bends', 'Radiohead'],
    ]);
  });

  it('keeps empty cells', () => {
    expect(parseCsv('a,,c\n,,')).toEqual([['a', '', 'c'], ['', '', '']]);
  });

  it('reads doubled quotes inside a quoted cell', () => {
    expect(parseCsv('"He said ""hi""","x"')).toEqual([['He said "hi"', 'x']]);
  });

  it('reads commas and line breaks inside a quoted cell', () => {
    expect(parseCsv('title,notes\n"A, B","line 1\nline 2"\n"C","d"')).toEqual([
      ['title', 'notes'],
      ['A, B', 'line 1\nline 2'],
      ['C', 'd'],
    ]);
  });

  it('accepts CRLF line ends, a final line break and a BOM', () => {
    expect(parseCsv('﻿a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('gives no row for an empty text', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv(null)).toEqual([]);
  });
});
