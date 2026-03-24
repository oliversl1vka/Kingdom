import { describe, it, expect } from 'vitest';
import {
  encryptCredential,
  decryptCredential,
} from '../../packages/core/src/security/credential-store.js';

describe('Credential Encryption Security', () => {
  const password = 'test-kingdom-password-2024';
  const apiKey = 'sk-test-1234567890abcdef';

  describe('AES-256-GCM roundtrip', () => {
    it('should encrypt and decrypt to original value', () => {
      const encrypted = encryptCredential('openai', apiKey, password);
      const decrypted = decryptCredential(encrypted, password);
      expect(decrypted).toBe(apiKey);
    });

    it('should produce different ciphertext each time (unique IV/salt)', () => {
      const enc1 = encryptCredential('openai', apiKey, password);
      const enc2 = encryptCredential('openai', apiKey, password);
      expect(enc1.iv).not.toBe(enc2.iv);
      expect(enc1.salt).not.toBe(enc2.salt);
      expect(enc1.encrypted_data).not.toBe(enc2.encrypted_data);
    });

    it('should fail decryption with wrong password', () => {
      const encrypted = encryptCredential('openai', apiKey, password);
      expect(() => decryptCredential(encrypted, 'wrong-password')).toThrow();
    });
  });

  describe('EncryptedCredential schema', () => {
    it('should match expected structure', () => {
      const encrypted = encryptCredential('anthropic', apiKey, password);
      expect(encrypted).toHaveProperty('provider_id', 'anthropic');
      expect(encrypted).toHaveProperty('algorithm', 'aes-256-gcm');
      expect(encrypted).toHaveProperty('encrypted_data');
      expect(encrypted).toHaveProperty('iv');
      expect(encrypted).toHaveProperty('salt');
      expect(encrypted).toHaveProperty('auth_tag');
    });

    it('should not contain plaintext API key anywhere', () => {
      const encrypted = encryptCredential('openai', apiKey, password);
      const serialized = JSON.stringify(encrypted);
      expect(serialized).not.toContain(apiKey);
    });
  });
});
