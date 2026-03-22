import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

export function generateAesKey(): string {
  return randomBytes(16).toString("base64");
}

export function aesEcbPaddedSize(size: number): number {
  const block = 16;
  return Math.floor((size + block - 1) / block) * block;
}

export function encryptAesEcb(key: Buffer, plaintext: Buffer): Buffer {
  const cipher = createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

export function decryptAesEcb(key: Buffer, ciphertext: Buffer): Buffer {
  const decipher = createDecipheriv("aes-128-ecb", key, null);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
