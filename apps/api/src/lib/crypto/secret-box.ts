import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const FORMAT_VERSION = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const HEADER_BYTES = 2;

export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretBoxError';
  }
}

/**
 * Authenticated encryption (AES-256-GCM) for secrets that must be read back, such as TOTP seeds.
 *
 * Layout: version (1 byte) | key id (1 byte) | nonce (12) | tag (16) | ciphertext.
 * The key id makes key rotation possible: old secrets stay readable while new ones use the
 * current key (ADR 0004).
 */
export class SecretBox {
  private readonly keys: ReadonlyMap<number, Buffer>;

  constructor(
    keys: Readonly<Record<number, Buffer>>,
    private readonly currentKeyId: number,
  ) {
    const entries = Object.entries(keys).map(([id, key]) => [Number(id), key] as const);
    for (const [id, key] of entries) {
      if (!Number.isInteger(id) || id < 1 || id > 255) {
        throw new SecretBoxError(`Invalid key id ${id}`);
      }
      if (key.length !== KEY_BYTES) {
        throw new SecretBoxError(`Key ${id} must be ${KEY_BYTES} bytes long`);
      }
    }
    this.keys = new Map(entries);
    if (!this.keys.has(currentKeyId)) {
      throw new SecretBoxError(`Unknown current key id ${currentKeyId}`);
    }
  }

  seal(plaintext: Buffer): Buffer {
    const key = this.key(this.currentKeyId);
    const nonce = randomBytes(NONCE_BYTES);
    const header = Buffer.from([FORMAT_VERSION, this.currentKeyId]);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    // The header is authenticated too: a changed key id or version fails decryption.
    cipher.setAAD(header);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([header, nonce, cipher.getAuthTag(), ciphertext]);
  }

  open(sealed: Buffer): Buffer {
    if (sealed.length < HEADER_BYTES + NONCE_BYTES + TAG_BYTES) {
      throw new SecretBoxError('Sealed value is too short');
    }
    const version = sealed.readUInt8(0);
    if (version !== FORMAT_VERSION) {
      throw new SecretBoxError(`Unsupported format version ${version}`);
    }
    const header = sealed.subarray(0, HEADER_BYTES);
    const nonce = sealed.subarray(HEADER_BYTES, HEADER_BYTES + NONCE_BYTES);
    const tag = sealed.subarray(HEADER_BYTES + NONCE_BYTES, HEADER_BYTES + NONCE_BYTES + TAG_BYTES);
    const ciphertext = sealed.subarray(HEADER_BYTES + NONCE_BYTES + TAG_BYTES);

    const decipher = createDecipheriv('aes-256-gcm', this.key(sealed.readUInt8(1)), nonce);
    decipher.setAAD(header);
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
      throw new SecretBoxError('Sealed value failed authentication');
    }
  }

  /** Whether the value was sealed with an older key and should be re-encrypted. */
  needsRotation(sealed: Buffer): boolean {
    return sealed.readUInt8(1) !== this.currentKeyId;
  }

  private key(id: number): Buffer {
    const key = this.keys.get(id);
    if (!key) {
      throw new SecretBoxError(`Unknown key id ${id}`);
    }
    return key;
  }
}
