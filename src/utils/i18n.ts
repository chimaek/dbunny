import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Internationalization (i18n) service
 * Supports Korean and English languages
 */
export class I18n {
    private static instance: I18n;
    private translations: Record<string, unknown> = {};
    private currentLocale: string = 'en';

    private constructor(private context: vscode.ExtensionContext) {}

    /**
     * Get singleton instance
     */
    static getInstance(context: vscode.ExtensionContext): I18n {
        if (!I18n.instance) {
            I18n.instance = new I18n(context);
        }
        return I18n.instance;
    }

    /**
     * Initialize i18n with appropriate locale
     */
    async initialize(): Promise<void> {
        const config = vscode.workspace.getConfiguration('dbunny');
        const language = config.get<string>('language', 'auto');

        if (language === 'auto') {
            // Use VS Code's language setting
            this.currentLocale = vscode.env.language.startsWith('ko') ? 'ko' : 'en';
        } else {
            this.currentLocale = language;
        }

        await this.loadTranslations(this.currentLocale);
    }

    /**
     * Load translation file for specified locale
     */
    private async loadTranslations(locale: string): Promise<void> {
        const localesDir = path.join(this.context.extensionPath, 'src', 'locales');
        const filePath = path.join(localesDir, `${locale}.json`);

        try {
            if (fs.existsSync(filePath)) {
                const content = await fs.promises.readFile(filePath, 'utf-8');
                this.translations = JSON.parse(content);
            } else if (locale !== 'en') {
                // Fallback to English
                await this.loadTranslations('en');
            }
        } catch (error) {
            console.error(`Failed to load translations for ${locale}:`, error);
            if (locale !== 'en') {
                await this.loadTranslations('en');
            }
        }
    }

    /**
     * Translate a key with optional parameters
     * @param key - Translation key (e.g., 'common.save')
     * @param params - Optional parameters for interpolation
     */
    t(key: string, params?: Record<string, string | number>): string {
        let text = this.getNestedValue(this.translations, key);

        if (typeof text !== 'string') {
            return key;
        }

        // Parameter interpolation
        if (params) {
            Object.entries(params).forEach(([param, value]) => {
                text = (text as string).replace(new RegExp(`\\{${param}\\}`, 'g'), String(value));
            });
        }

        return text;
    }

    /**
     * Get nested value from object using dot notation
     */
    private getNestedValue(obj: unknown, key: string): unknown {
        const keys = key.split('.');
        let value: unknown = obj;

        for (const k of keys) {
            if (value && typeof value === 'object' && k in value) {
                value = (value as Record<string, unknown>)[k];
            } else {
                return undefined;
            }
        }

        return value;
    }

    /**
     * Get current locale
     */
    getCurrentLocale(): string {
        return this.currentLocale;
    }

    /**
     * Set locale and reload translations
     */
    async setLocale(locale: string): Promise<void> {
        if (this.currentLocale !== locale) {
            this.currentLocale = locale;
            await this.loadTranslations(locale);

            const config = vscode.workspace.getConfiguration('dbunny');
            await config.update('language', locale, vscode.ConfigurationTarget.Global);
        }
    }
}
