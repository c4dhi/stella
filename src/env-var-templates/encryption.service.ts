import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/**
 * EncryptionService provides AES-256-GCM encryption for secure storage
 * of sensitive environment variable values.
 *
 * Storage format: {iv}:{authTag}:{encryptedData} (all base64 encoded)
 *
 * Security features:
 * - AES-256-GCM provides both confidentiality and integrity
 * - Random IV for each encryption (prevents pattern analysis)
 * - Authentication tag prevents tampering
 */
@Injectable()
export class EncryptionService implements OnModuleInit {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly algorithm = 'aes-256-gcm';
  private key: Buffer | null = null;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const keyHex = this.configService.get<string>('ENV_VAR_ENCRYPTION_KEY');

    if (!keyHex) {
      this.logger.warn(
        'ENV_VAR_ENCRYPTION_KEY not set. Environment variable encryption will be disabled. ' +
          'Generate a key with: openssl rand -hex 32',
      );
      return;
    }

    if (keyHex.length !== 64) {
      throw new Error(
        'ENV_VAR_ENCRYPTION_KEY must be a 32-byte hex string (64 characters). ' +
          'Generate with: openssl rand -hex 32',
      );
    }

    this.key = Buffer.from(keyHex, 'hex');
    this.logger.log('Encryption service initialized');
  }

  /**
   * Check if encryption is available
   */
  isEnabled(): boolean {
    return this.key !== null;
  }

  /**
   * Encrypt a dictionary of environment variables
   * @param data Key-value pairs of environment variables
   * @returns Encrypted string in format: iv:authTag:encryptedData
   */
  encrypt(data: Record<string, string>): string {
    if (!this.key) {
      // When encryption is disabled, store as base64-encoded JSON
      // This is NOT secure - just for development without encryption key
      this.logger.warn(
        'Encrypting without key - data is NOT securely stored',
      );
      return `nokey:${Buffer.from(JSON.stringify(data)).toString('base64')}`;
    }

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);

    const json = JSON.stringify(data);
    const encrypted = Buffer.concat([
      cipher.update(json, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
  }

  /**
   * Decrypt an encrypted environment variable string
   * @param encryptedString String in format: iv:authTag:encryptedData
   * @returns Decrypted key-value pairs
   */
  decrypt(encryptedString: string): Record<string, string> {
    // Handle unencrypted data (development mode without key)
    if (encryptedString.startsWith('nokey:')) {
      this.logger.warn('Decrypting data stored without encryption');
      const base64Data = encryptedString.substring(6);
      return JSON.parse(Buffer.from(base64Data, 'base64').toString('utf8'));
    }

    if (!this.key) {
      throw new Error(
        'Cannot decrypt: ENV_VAR_ENCRYPTION_KEY not configured',
      );
    }

    const parts = encryptedString.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }

    const [ivB64, authTagB64, dataB64] = parts;

    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(authTagB64, 'base64');
    const encrypted = Buffer.from(dataB64, 'base64');

    const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return JSON.parse(decrypted.toString('utf8'));
  }

  /**
   * Extract variable keys from encrypted data without full decryption
   * Used for API responses to avoid exposing values
   */
  getKeys(encryptedString: string): string[] {
    const data = this.decrypt(encryptedString);
    return Object.keys(data);
  }
}
