import { isIPv4, isIPv6 } from 'node:net';

/** Converts an IPv4 or IPv6 address to a bigint and its bit length. IPv4-mapped IPv6 is unwrapped. */
function toBigInt(address: string): { value: bigint; bits: 32 | 128 } | null {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  const ip = mapped?.[1] ?? address;

  if (isIPv4(ip)) {
    const value = ip.split('.').reduce((total, part) => (total << 8n) + BigInt(Number(part)), 0n);
    return { value, bits: 32 };
  }

  if (isIPv6(ip)) {
    const [head = '', tail = ''] = ip.split('::');
    const headParts = head ? head.split(':') : [];
    const tailParts = ip.includes('::') && tail ? tail.split(':') : [];
    const missing = 8 - headParts.length - tailParts.length;
    const groups = ip.includes('::')
      ? [...headParts, ...Array<string>(missing).fill('0'), ...tailParts]
      : headParts;
    const value = groups.reduce((total, group) => (total << 16n) + BigInt(parseInt(group, 16)), 0n);
    return { value, bits: 128 };
  }

  return null;
}

/** Whether `address` belongs to `cidr` (e.g. 10.0.0.0/8, 2001:db8::/32). Invalid input never matches. */
export function ipInCidr(address: string, cidr: string): boolean {
  const [network = '', prefixText] = cidr.split('/');
  const ip = toBigInt(address);
  const net = toBigInt(network);
  if (ip === null || net === null) {
    return false;
  }
  if (ip.bits !== net.bits) {
    return false;
  }
  const prefix = prefixText === undefined ? net.bits : Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > net.bits) {
    return false;
  }
  const shift = BigInt(net.bits - prefix);
  return ip.value >> shift === net.value >> shift;
}
