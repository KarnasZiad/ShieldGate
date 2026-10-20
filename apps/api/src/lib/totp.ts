import { createHmac } from 'node:crypto';
import { safeEqualStrings } from './crypto/tokens.js';

export interface TotpOptions {
  /** Time step in seconds (RFC 6238 default: 30). */
  step?: number;
  digits?: number;
  algorithm?: 'sha1' | 'sha256' | 'sha512';
}

const DEFAULTS = { step: 30, digits: 6, algorithm: 'sha1' } as const;

/** HOTP, RFC 4226: HMAC of an 8-byte counter, dynamically truncated to `digits` digits. */
export function hotp(
  secret: Buffer,
  counter: number,
  { digits = DEFAULTS.digits, algorithm = DEFAULTS.algorithm }: TotpOptions = {},
): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac(algorithm, secret).update(message).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export function timeStep(timeMs: number, step: number = DEFAULTS.step): number {
  return Math.floor(timeMs / 1000 / step);
}

/** TOTP, RFC 6238: HOTP whose counter is the number of time steps since the Unix epoch. */
export function totp(secret: Buffer, timeMs: number, options: TotpOptions = {}): string {
  return hotp(secret, timeStep(timeMs, options.step), options);
}

export interface VerifyTotpOptions extends TotpOptions {
  /** Accepted clock drift, in steps on each side. */
  window?: number;
  /** Last step already used by this user: a code is valid only once (replay protection). */
  lastUsedStep?: number | null;
}

/** Returns the matching time step, or null. Every candidate is compared in constant time. */
export function verifyTotp(
  secret: Buffer,
  code: string,
  timeMs: number,
  { window = 1, lastUsedStep = null, ...options }: VerifyTotpOptions = {},
): number | null {
  const digits = options.digits ?? DEFAULTS.digits;
  if (!new RegExp(`^[0-9]{${digits}}$`).test(code)) {
    return null;
  }
  const current = timeStep(timeMs, options.step);
  let matched: number | null = null;
  for (let step = current - window; step <= current + window; step += 1) {
    const isMatch = safeEqualStrings(hotp(secret, step, options), code);
    if (isMatch && matched === null && (lastUsedStep === null || step > lastUsedStep)) {
      matched = step;
    }
  }
  return matched;
}

export function otpauthUri(params: {
  secretBase32: string;
  account: string;
  issuer: string;
}): string {
  const label = encodeURIComponent(`${params.issuer}:${params.account}`);
  const query = new URLSearchParams({
    secret: params.secretBase32,
    issuer: params.issuer,
    algorithm: 'SHA1',
    digits: String(DEFAULTS.digits),
    period: String(DEFAULTS.step),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}
