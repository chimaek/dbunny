import type * as vscode from 'vscode';
import { ConnectionConfig } from '../types/database';
import { EncryptionService } from './encryption';

interface Credentials {
    password?: string;
    sshPassword?: string;
    privateKey?: string;
    passphrase?: string;
}

/** 일반 상태에는 비밀값을 남기지 않고, 연결 ID별 SecretStorage에만 보관한다. */
export class CredentialStore {
    constructor(private readonly secrets: vscode.SecretStorage, private readonly encryption: EncryptionService) {}

    private key(id: string): string { return `dbunny.credentials.${id}`; }

    sanitize(config: ConnectionConfig): ConnectionConfig {
        const { password: _password, ...metadata } = config;
        if (config.ssh) {
            const { password: _sshPassword, privateKey: _privateKey, passphrase: _passphrase, ...ssh } = config.ssh;
            metadata.ssh = ssh;
        }
        return metadata;
    }

    private async read(id: string): Promise<Credentials> {
        const value = await this.secrets.get(this.key(id));
        return value ? JSON.parse(value) as Credentials : {};
    }

    async save(config: ConnectionConfig): Promise<ConnectionConfig> {
        const credentials = await this.read(config.id);
        // 편집 폼의 빈 비밀번호는 기존 값을 유지한다. 연결 삭제 시 함께 제거한다.
        if (config.password) { credentials.password = config.password; }
        if (config.ssh) {
            if (config.ssh.password) { credentials.sshPassword = config.ssh.password; }
            if (config.ssh.privateKey) { credentials.privateKey = config.ssh.privateKey; }
            if (config.ssh.passphrase) { credentials.passphrase = config.ssh.passphrase; }
        } else {
            delete credentials.sshPassword;
            delete credentials.privateKey;
            delete credentials.passphrase;
        }
        await this.secrets.store(this.key(config.id), JSON.stringify(credentials));
        return this.sanitize(config);
    }

    async resolve(config: ConnectionConfig): Promise<ConnectionConfig> {
        const credentials = await this.read(config.id);
        return {
            ...config,
            password: credentials.password,
            ssh: config.ssh ? {
                ...config.ssh,
                password: credentials.sshPassword,
                privateKey: credentials.privateKey,
                passphrase: credentials.passphrase
            } : undefined
        };
    }

    async migrate(config: ConnectionConfig): Promise<ConnectionConfig> {
        const migrated = { ...config, ssh: config.ssh ? { ...config.ssh } : undefined };
        if (config.password) {
            // 구버전의 AES 암호문을 한 번만 이전한다. 복호화 실패 시 원본 상태를 지우지 않는다.
            migrated.password = await this.encryption.decrypt(config.password);
        }
        return this.save(migrated);
    }

    async duplicate(source: ConnectionConfig, newId: string): Promise<ConnectionConfig> {
        const resolved = await this.resolve(source);
        return this.save({ ...resolved, id: newId, name: `${source.name} (Copy)` });
    }

    async delete(id: string): Promise<void> { await this.secrets.delete(this.key(id)); }
}
