import { describe, expect, it } from 'vitest';
import { ipInCidr } from './ip.js';

describe('ipInCidr', () => {
  it.each([
    ['10.0.4.12', '10.0.0.0/8', true],
    ['10.0.4.12', '10.0.4.0/24', true],
    ['10.0.5.12', '10.0.4.0/24', false],
    ['196.12.4.8', '196.12.4.8', true],
    ['196.12.4.9', '196.12.4.8/32', false],
    ['8.8.8.8', '0.0.0.0/0', true],
    ['::ffff:10.0.4.12', '10.0.0.0/8', true],
    ['2001:db8::1', '2001:db8::/32', true],
    ['2001:db9::1', '2001:db8::/32', false],
    ['::1', '::1/128', true],
    ['fe80::1:2:3:4', 'fe80::/10', true],
  ])('%s in %s: %s', (address, cidr, expected) => {
    expect(ipInCidr(address, cidr)).toBe(expected);
  });

  it.each([
    ['not-an-ip', '10.0.0.0/8'],
    ['10.0.0.1', 'not-a-network/8'],
    ['10.0.0.1', '10.0.0.0/33'],
    ['10.0.0.1', '10.0.0.0/x'],
    ['10.0.0.1', '2001:db8::/32'],
  ])('never matches invalid input (%s, %s)', (address, cidr) => {
    expect(ipInCidr(address, cidr)).toBe(false);
  });
});
