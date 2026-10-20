/** Pending second factor between the password step and the TOTP step. */
export interface MfaChallenge {
  userId: string;
  attempts: number;
}

export interface MfaChallengeStore {
  create(userId: string, ttlMs: number): Promise<string>;
  /** Counts an attempt and returns the challenge, or null when unknown or expired. */
  attempt(id: string): Promise<MfaChallenge | null>;
  delete(id: string): Promise<void>;
}

export const MFA_CHALLENGE_TTL_MS = 5 * 60_000;
/** A 6-digit code has a million values: five tries per challenge keeps guessing hopeless. */
export const MFA_MAX_ATTEMPTS = 5;
