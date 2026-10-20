/**
 * Password rules following NIST SP 800-63B: length and a blocklist rather than composition rules
 * (no "one uppercase, one symbol"), which only push users toward predictable patterns.
 * A breached-password check (Have I Been Pwned, k-anonymity API) is planned for v2.
 */
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;
const MIN_DISTINCT_CHARACTERS = 5;

export type PasswordProblem =
  'too_short' | 'too_long' | 'common' | 'too_simple' | 'contains_identity';

/** Frequent long passwords from public leak statistics, plus local favorites. */
const COMMON_PASSWORDS = new Set([
  '123456789012',
  '1234567890123',
  '12345678901234',
  '1q2w3e4r5t6y',
  '1qaz2wsx3edc',
  'qwertyuiop12',
  'qwertyuiop123',
  'qwerty123456',
  'azertyuiop12',
  'azertyuiop123',
  'azerty123456',
  'password1234',
  'password12345',
  'password123456',
  'passw0rd1234',
  'motdepasse12',
  'motdepasse123',
  'motdepasse1234',
  'iloveyou1234',
  'welcome12345',
  'administrator',
  'administrateur',
  'changeme1234',
  'letmein12345',
  'football1234',
  'marrakech123',
  'marrakech2025',
  'marrakech2026',
  'casablanca123',
  'maroc1234567',
  'bismillah123',
]);

export function checkPassword(
  password: string,
  identity: { email: string; displayName?: string },
): PasswordProblem[] {
  const normalized = password.normalize('NFKC');
  // NIST 800-63B counts each Unicode code point as one character.
  const length = Array.from(normalized).length;
  const lower = normalized.toLowerCase();
  const problems: PasswordProblem[] = [];

  if (length < MIN_PASSWORD_LENGTH) problems.push('too_short');
  if (length > MAX_PASSWORD_LENGTH) problems.push('too_long');
  if (COMMON_PASSWORDS.has(lower)) problems.push('common');
  if (new Set(lower).size < MIN_DISTINCT_CHARACTERS) problems.push('too_simple');

  const localPart = identity.email.toLowerCase().split('@')[0] ?? '';
  const nameParts = (identity.displayName ?? '').toLowerCase().split(/\s+/);
  const identityParts = [localPart, ...nameParts].filter((part) => part.length >= 4);
  if (identityParts.some((part) => lower.includes(part))) problems.push('contains_identity');

  return problems;
}
