function getTestVersions(env = process.env) {
    const versions = env.VSCODE_TEST_VERSIONS
        ? JSON.parse(env.VSCODE_TEST_VERSIONS)
        : [env.VSCODE_TEST_VERSION || 'stable'];
    if (!Array.isArray(versions) || !versions.length || versions.some(version => typeof version !== 'string' || !/^(?:stable|insiders|\d+\.\d+\.\d+)$/.test(version))) {
        throw new Error('VSCODE_TEST_VERSIONS must be a non-empty JSON array of VS Code versions');
    }
    return [...new Set(versions)];
}
module.exports = { getTestVersions };
