import crypto from 'crypto';

// AES-256-GCM Column-level Encryption
export function encryptField(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext}`;
}

// AES-256-GCM Column-level Decryption
export function decryptField(encryptedString: string, key: Buffer): string {
  const [ivHex, tagHex, ciphertextHex] = encryptedString.split(':');
  if (!ivHex || !tagHex || !ciphertextHex) {
    throw new Error("Invalid GCM encrypted payload format.");
  }
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  let plaintext = decipher.update(ciphertextHex, 'hex', 'utf8');
  plaintext += decipher.final('utf8');
  return plaintext;
}
