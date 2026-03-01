import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    test('Extension should be present', () => {
        assert.ok(vscode.extensions.getExtension('chimaek.dbunny'));
    });

    test('Commands should be registered', async () => {
        const commands = await vscode.commands.getCommands(true);

        assert.ok(commands.includes('dbunny.addConnection'));
        assert.ok(commands.includes('dbunny.editConnection'));
        assert.ok(commands.includes('dbunny.deleteConnection'));
        assert.ok(commands.includes('dbunny.connect'));
        assert.ok(commands.includes('dbunny.disconnect'));
        assert.ok(commands.includes('dbunny.executeQuery'));
        assert.ok(commands.includes('dbunny.newQuery'));
        assert.ok(commands.includes('dbunny.refreshConnection'));
    });
});
