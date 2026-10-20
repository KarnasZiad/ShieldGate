import { describe, expect, it } from 'vitest';
import { FixedClock } from '../../lib/clock.js';
import { InMemoryLoginThrottleStore } from '../../testing/in-memory-auth-stores.js';
import { DEFAULT_THROTTLE_RULES, LoginThrottle } from './login-throttle.js';

const MINUTE = 60_000;

function setup() {
  const clock = new FixedClock(0);
  return { clock, throttle: new LoginThrottle(new InMemoryLoginThrottleStore(clock)) };
}

describe('LoginThrottle', () => {
  it('locks an account on the fifth failure, and only reports it once', async () => {
    const { throttle } = setup();
    const results = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      results.push((await throttle.onFailure('amina@exemple.ma', '203.0.113.1')).lockedNow);
    }

    expect(results).toEqual([false, false, false, false, true, false]);
    await expect(throttle.check('AMINA@exemple.ma', '203.0.113.9')).resolves.toBe('account_locked');
  });

  it('forgets failures after the window', async () => {
    const { clock, throttle } = setup();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await throttle.onFailure('amina@exemple.ma', '203.0.113.1');
    }

    clock.advance(DEFAULT_THROTTLE_RULES.accountWindowMs);

    await expect(throttle.check('amina@exemple.ma', '203.0.113.1')).resolves.toBe('allowed');
  });

  it('resets the counter after a successful sign-in or an unlock', async () => {
    const { throttle } = setup();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await throttle.onFailure('amina@exemple.ma', '203.0.113.1');
    }
    await throttle.onSuccess('amina@exemple.ma');
    await throttle.onFailure('amina@exemple.ma', '203.0.113.1');

    await expect(throttle.check('amina@exemple.ma', '203.0.113.1')).resolves.toBe('allowed');
    await throttle.unlock('amina@exemple.ma');
  });

  it('blocks an IP that fails on more than 10 different accounts, for an hour', async () => {
    const { clock, throttle } = setup();
    const outcomes = [];
    for (let account = 0; account < 11; account += 1) {
      outcomes.push(
        (await throttle.onFailure(`user${account}@exemple.ma`, '198.51.100.66')).ipBlockedNow,
      );
    }

    expect(outcomes.slice(0, 10).every((blocked) => !blocked)).toBe(true);
    expect(outcomes[10]).toBe(true);
    await expect(throttle.check('anyone@exemple.ma', '198.51.100.66')).resolves.toBe('ip_blocked');
    await expect(throttle.check('anyone@exemple.ma', '198.51.100.67')).resolves.toBe('allowed');

    clock.advance(60 * MINUTE);
    await expect(throttle.check('anyone@exemple.ma', '198.51.100.66')).resolves.toBe('allowed');
  });

  it('does not count repeated failures on the same account as stuffing', async () => {
    const { throttle } = setup();
    let blocked = false;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      blocked ||= (await throttle.onFailure('amina@exemple.ma', '203.0.113.1')).ipBlockedNow;
    }

    expect(blocked).toBe(false);
  });

  it('keys accounts by a hash: e-mail addresses never reach Redis', () => {
    expect(LoginThrottle.accountKey(' Amina@Exemple.ma ')).toBe(
      LoginThrottle.accountKey('amina@exemple.ma'),
    );
    expect(LoginThrottle.accountKey('amina@exemple.ma')).toMatch(/^[0-9a-f]{64}$/);
  });
});
