import { describe, expect, it } from 'vitest';
import { hotp, otpauthUri, totp, verifyTotp } from './totp.js';

// RFC 6238, appendix B: one seed per algorithm, 8-digit codes.
const SEEDS = {
  sha1: Buffer.from('12345678901234567890'),
  sha256: Buffer.from('12345678901234567890123456789012'),
  sha512: Buffer.from('1234567890123456789012345678901234567890123456789012345678901234'),
};

const RFC_6238_VECTORS: [number, string, string, string][] = [
  [59, '94287082', '46119246', '90693936'],
  [1111111109, '07081804', '68084774', '25091201'],
  [1111111111, '14050471', '67062674', '99943326'],
  [1234567890, '89005924', '91819424', '93441116'],
  [2000000000, '69279037', '90698825', '38618901'],
  [20000000000, '65353130', '77737706', '47863826'],
];

describe('HOTP (RFC 4226 appendix D)', () => {
  const expected = ['755224', '287082', '359152', '969429', '338314', '254676'];

  it.each(expected.map((code, counter) => [counter, code]))(
    'counter %i gives %s',
    (counter, code) => {
      expect(hotp(SEEDS.sha1, counter)).toBe(code);
    },
  );
});

describe('TOTP (RFC 6238 appendix B)', () => {
  it.each(RFC_6238_VECTORS)(
    'at %i s: SHA1 %s, SHA256 %s, SHA512 %s',
    (seconds, sha1, sha256, sha512) => {
      const time = seconds * 1000;

      expect(totp(SEEDS.sha1, time, { digits: 8, algorithm: 'sha1' })).toBe(sha1);
      expect(totp(SEEDS.sha256, time, { digits: 8, algorithm: 'sha256' })).toBe(sha256);
      expect(totp(SEEDS.sha512, time, { digits: 8, algorithm: 'sha512' })).toBe(sha512);
    },
  );
});

describe('verifyTotp', () => {
  const secret = SEEDS.sha1;
  const now = 1_760_000_000_000;
  const step = Math.floor(now / 30_000);

  it('accepts the current code and returns its time step', () => {
    expect(verifyTotp(secret, totp(secret, now), now)).toBe(step);
  });

  it('tolerates one step of clock drift on each side, not more', () => {
    expect(verifyTotp(secret, totp(secret, now - 30_000), now)).toBe(step - 1);
    expect(verifyTotp(secret, totp(secret, now + 30_000), now)).toBe(step + 1);
    expect(verifyTotp(secret, totp(secret, now - 60_000), now)).toBeNull();
  });

  it('refuses a code that was already used (replay)', () => {
    const code = totp(secret, now);

    expect(verifyTotp(secret, code, now, { lastUsedStep: step })).toBeNull();
    expect(verifyTotp(secret, code, now, { lastUsedStep: step - 1 })).toBe(step);
  });

  it.each(['', '12345', '1234567', 'abcdef', '12 456'])(
    'refuses the malformed code "%s"',
    (code) => {
      expect(verifyTotp(secret, code, now)).toBeNull();
    },
  );
});

describe('otpauthUri', () => {
  it('builds the URI scanned by authenticator apps', () => {
    expect(
      otpauthUri({
        secretBase32: 'JBSWY3DPEHPK3PXP',
        account: 'amina@exemple.ma',
        issuer: 'ShieldGate',
      }),
    ).toBe(
      'otpauth://totp/ShieldGate%3Aamina%40exemple.ma?secret=JBSWY3DPEHPK3PXP&issuer=ShieldGate&algorithm=SHA1&digits=6&period=30',
    );
  });
});
