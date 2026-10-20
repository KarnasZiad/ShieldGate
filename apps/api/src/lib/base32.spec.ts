import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode } from './base32.js';

// RFC 4648, section 10.
const VECTORS: [string, string][] = [
  ['', ''],
  ['f', 'MY======'],
  ['fo', 'MZXQ===='],
  ['foo', 'MZXW6==='],
  ['foob', 'MZXW6YQ='],
  ['fooba', 'MZXW6YTB'],
  ['foobar', 'MZXW6YTBOI======'],
];

describe('base32', () => {
  it.each(VECTORS)('encodes "%s" as "%s"', (input, expected) => {
    expect(base32Encode(Buffer.from(input))).toBe(expected);
  });

  it.each(VECTORS)('decodes back "%s"', (input, encoded) => {
    expect(base32Decode(encoded).toString()).toBe(input);
  });

  it('omits padding on request and decodes lowercase input with spaces', () => {
    expect(base32Encode(Buffer.from('foobar'), { padding: false })).toBe('MZXW6YTBOI');
    expect(base32Decode('mzxw 6ytb oi').toString()).toBe('foobar');
  });

  it('rejects characters outside the alphabet', () => {
    expect(() => base32Decode('MZXW1')).toThrow('Invalid base32 character "1"');
  });
});
