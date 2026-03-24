import { createHash, createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface EncryptedCredential {
  provider_id: string;
  encrypted_data: string; // base64
  iv: string;            // base64
  salt: string;          // base64
  algorithm: 'aes-256-gcm';
  auth_tag: string;      // base64
}

export interface CredentialStore {
  version: number;
  credentials: EncryptedCredential[];
}

const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16;
const SALT_LENGTH = 32;

function deriveKey(password: string, salt: Buffer): Buffer {
  return pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');
}

export function encryptCredential(
  providerId: string,
  apiKey: string,
  password: string
): EncryptedCredential {
  const salt = randomBytes(SALT_LENGTH);
  const key = deriveKey(password, salt);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    provider_id: providerId,
    encrypted_data: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    salt: salt.toString('base64'),
    algorithm: 'aes-256-gcm',
    auth_tag: authTag.toString('base64'),
  };
}

export function decryptCredential(cred: EncryptedCredential, password: string): string {
  const salt = Buffer.from(cred.salt, 'base64');
  const key = deriveKey(password, salt);
  const iv = Buffer.from(cred.iv, 'base64');
  const authTag = Buffer.from(cred.auth_tag, 'base64');

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(cred.encrypted_data, 'base64')),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

export function loadCredentialStore(kingdomDir: string): CredentialStore {
  const filePath = join(kingdomDir, '.credentials.enc');
  if (!existsSync(filePath)) {
    return { version: 1, credentials: [] };
  }
  const data = readFileSync(filePath, 'utf8');
  return JSON.parse(data) as CredentialStore;
}

export function saveCredentialStore(kingdomDir: string, store: CredentialStore): void {
  const filePath = join(kingdomDir, '.credentials.enc');
  writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf8');
}

export function setProviderCredential(
  kingdomDir: string,
  providerId: string,
  apiKey: string,
  password: string
): void {
  const store = loadCredentialStore(kingdomDir);
  const existing = store.credentials.findIndex((c) => c.provider_id === providerId);
  const cred = encryptCredential(providerId, apiKey, password);

  if (existing >= 0) {
    store.credentials[existing] = cred;
  } else {
    store.credentials.push(cred);
  }

  saveCredentialStore(kingdomDir, store);
}

export function getProviderCredential(
  kingdomDir: string,
  providerId: string,
  password: string
): string | null {
  const store = loadCredentialStore(kingdomDir);
  const cred = store.credentials.find((c) => c.provider_id === providerId);
  if (!cred) return null;
  return decryptCredential(cred, password);
}
