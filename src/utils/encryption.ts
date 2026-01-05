import * as crypto from 'crypto';
import * as vscode from 'vscode';

/**
 * Encryption service for secure credential storage
 * Uses AES-256-GCM for authenticated encryption
 */
export class EncryptionService {
    private readonly algorithm = 'aes-256-gcm';
    private readonly keyLength = 32; // 256 bits
    private readonly ivLength = 16; // 128 bits
    private readonly authTagLength = 16; // 128 bits

    constructor(private context: vscode.ExtensionContext) {}

    /**
     * Encrypt plaintext using AES-256-GCM
     */
    async encrypt(plaintext: string): Promise<string> {
        const key = await this.getEncryptionKey();
        const iv = crypto.randomBytes(this.ivLength);

        const cipher = crypto.createCipheriv(this.algorithm, key, iv, {
            authTagLength: this.authTagLength
        });

        let encrypted = cipher.update(plaintext, 'utf8', 'hex');
        encrypted += cipher.final('hex');

        const authTag = cipher.getAuthTag();

        // Combine IV, auth tag, and encrypted data
        const result = {
            iv: iv.toString('hex'),
            authTag: authTag.toString('hex'),
            encrypted
        };

        return Buffer.from(JSON.stringify(result)).toString('base64');
    }

    /**
     * Decrypt ciphertext using AES-256-GCM
     */
    async decrypt(ciphertext: string): Promise<string> {
        const key = await this.getEncryptionKey();

        const data = JSON.parse(Buffer.from(ciphertext, 'base64').toString('utf8'));
        const iv = Buffer.from(data.iv, 'hex');
        const authTag = Buffer.from(data.authTag, 'hex');
        const encrypted = data.encrypted;

        const decipher = crypto.createDecipheriv(this.algorithm, key, iv, {
            authTagLength: this.authTagLength
        });
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    }

    /**
     * Get or generate encryption key
     */
    private async getEncryptionKey(): Promise<Buffer> {
        let keyHex = await this.context.secrets.get('dbunny.encryptionKey');

        if (!keyHex) {
            // Generate new key
            const key = crypto.randomBytes(this.keyLength);
            keyHex = key.toString('hex');
            await this.context.secrets.store('dbunny.encryptionKey', keyHex);
        }

        return Buffer.from(keyHex, 'hex');
    }

    /**
     * Hash a string using SHA-256
     */
    hash(text: string): string {
        return crypto.createHash('sha256').update(text).digest('hex');
    }

    /**
     * Generate a random ID
     */
    generateId(): string {
        return crypto.randomUUID();
    }
}
