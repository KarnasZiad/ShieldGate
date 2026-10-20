import { describe, expect, it } from 'vitest';
import { checkPassword } from './password-policy.js';

const identity = { email: 'amina.benali@exemple.ma', displayName: 'Amina Benali' };

describe('checkPassword', () => {
  it('accepts a long passphrase without composition rules', () => {
    expect(checkPassword('le thé à la menthe de grand-mère', identity)).toEqual([]);
    expect(checkPassword('correcthorsebatterystaple', identity)).toEqual([]);
  });

  it('measures length in characters, not bytes', () => {
    expect(checkPassword('ثلاثة أقلام', identity)).toEqual(['too_short']);
    expect(checkPassword('ثلاثة أقلام زرقاء', identity)).toEqual([]);
  });

  it.each([
    ['short1!', ['too_short']],
    ['x'.repeat(129), ['too_long', 'too_simple']],
    ['Password1234', ['common']],
    ['MARRAKECH2026', ['common']],
    ['aaaaaaaaaaaaaaaa', ['too_simple']],
    ['abababababab', ['too_simple']],
    ['amina.benali-2026!', ['contains_identity']],
    ['my name is benali, okay?', ['contains_identity']],
  ])('flags "%s"', (password, problems) => {
    expect(checkPassword(password, identity)).toEqual(problems);
  });
});
