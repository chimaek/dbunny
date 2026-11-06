import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
    label: 'extension-host',
    version: process.env.VSCODE_TEST_VERSION || 'stable',
    files: ['out/test/suite/**/*.test.js', 'out/test/host/**/*.test.js'],
    launchArgs: ['--disable-extensions', '--skip-welcome', '--skip-release-notes'],
    mocha: { ui: 'tdd', timeout: 20000 }
});
