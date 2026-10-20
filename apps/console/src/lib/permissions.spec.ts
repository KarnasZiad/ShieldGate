import { describe, expect, it } from 'vitest';
import { hasPermission, matchesPermission } from './permissions';

describe('permissions', () => {
  it.each([
    ['*', 'users:write', true],
    ['users:*', 'users:write', true],
    ['users:read', 'users:read', true],
    ['users:read', 'users:write', false],
    ['audit:*', 'users:read', false],
  ])('%s grants %s: %s', (pattern, permission, expected) => {
    expect(matchesPermission(pattern, permission)).toBe(expected);
  });

  it('checks a list of granted permissions', () => {
    expect(hasPermission(['users:read', 'audit:read'], 'audit:read')).toBe(true);
    expect(hasPermission([], 'audit:read')).toBe(false);
  });
});
