import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { TEST_ENV } from './testing/config.js';

describe('loadConfig', () => {
  it('applies secure defaults', () => {
    const config = loadConfig({ ...TEST_ENV, NODE_ENV: 'production', CONSOLE_ORIGINS: undefined });

    expect(config).toMatchObject({
      PORT: 4000,
      COOKIE_SECURE: true,
      SESSION_IDLE_MINUTES: 30,
      SESSION_ABSOLUTE_HOURS: 12,
      TRUST_PROXY_HOPS: 0,
      CONSOLE_ORIGINS: ['http://localhost:5173'],
      TOTP_ENCRYPTION_KEY_ID: 1,
    });
    expect(config.TOTP_ENCRYPTION_KEYS[1]).toHaveLength(32);
    expect(config.API_KEY_PEPPER).toHaveLength(32);
  });

  it('parses a keyring with several keys', () => {
    const key = Buffer.alloc(32, 1).toString('base64');
    const config = loadConfig({
      ...TEST_ENV,
      TOTP_ENCRYPTION_KEYS: `1:${key}, 2:${key}`,
      TOTP_ENCRYPTION_KEY_ID: '2',
    });

    expect(Object.keys(config.TOTP_ENCRYPTION_KEYS)).toEqual(['1', '2']);
  });

  it.each([
    [
      'a short encryption key',
      { TOTP_ENCRYPTION_KEYS: `1:${Buffer.alloc(16).toString('base64')}` },
    ],
    ['a malformed keyring', { TOTP_ENCRYPTION_KEYS: 'not-a-keyring' }],
    ['a short pepper', { API_KEY_PEPPER: Buffer.alloc(8).toString('base64') }],
    ['a database URL of the wrong kind', { DATABASE_URL: 'mysql://localhost/db' }],
    ['an unknown current key id', { TOTP_ENCRYPTION_KEY_ID: '3' }],
  ])('refuses %s', (_label, overrides) => {
    expect(() => loadConfig({ ...TEST_ENV, ...overrides })).toThrow();
  });
});
