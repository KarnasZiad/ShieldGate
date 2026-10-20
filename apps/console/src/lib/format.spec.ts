import { describe, expect, it } from 'vitest';
import { describeUserAgent, formatDateTime } from './format';

describe('format', () => {
  it('formats dates and missing values', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('2026-10-20T09:30:00Z')).toMatch(/20\/10\/2026/);
  });

  it.each([
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36',
      'Chrome · Windows',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/141.0 Safari/537.36 Edg/141.0',
      'Edge · Windows',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Safari/604.1',
      'Safari · iOS',
    ],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0', 'Firefox · Linux'],
    ['curl/8.0', 'Navigateur · système inconnu'],
  ])('describes %s', (userAgent, expected) => {
    expect(describeUserAgent(userAgent)).toBe(expected);
  });
});
