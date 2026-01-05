import * as vscode from 'vscode';

/**
 * CodeLens provider for SQL files
 * Shows "Run Query" button above SQL statements
 */
export class SqlCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

    constructor() {
        // Refresh code lenses when document changes
        vscode.workspace.onDidChangeTextDocument(() => {
            this._onDidChangeCodeLenses.fire();
        });
    }

    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        const codeLenses: vscode.CodeLens[] = [];
        const text = document.getText();
        const lines = text.split('\n');

        let statementStart = -1;
        let inStatement = false;
        let statementLines: string[] = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Skip empty lines and comments at the start
            if (!inStatement) {
                if (line === '' || line.startsWith('--') || line.startsWith('//') || line.startsWith('#')) {
                    continue;
                }
                // Start of a new statement
                statementStart = i;
                inStatement = true;
                statementLines = [line];
            } else {
                statementLines.push(line);
            }

            // Check if statement ends (semicolon at end of line)
            if (line.endsWith(';') || (i === lines.length - 1 && inStatement)) {
                // Create CodeLens for this statement
                const range = new vscode.Range(statementStart, 0, statementStart, 0);
                const statement = statementLines.join('\n');

                // Only add CodeLens for actual SQL statements (not just comments)
                if (this.isValidStatement(statement)) {
                    codeLenses.push(new vscode.CodeLens(range, {
                        title: '▶ Run Query',
                        command: 'dbunny.executeQueryAtCursor',
                        arguments: [document, statementStart, i]
                    }));
                }

                inStatement = false;
                statementLines = [];
            }
        }

        return codeLenses;
    }

    private isValidStatement(statement: string): boolean {
        // Remove comments and check if there's actual SQL
        const cleanStatement = statement
            .split('\n')
            .filter(line => !line.trim().startsWith('--') && !line.trim().startsWith('//') && !line.trim().startsWith('#'))
            .join(' ')
            .trim();

        if (!cleanStatement) {
            return false;
        }

        // Check for common SQL keywords
        const sqlKeywords = [
            'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER',
            'SHOW', 'DESCRIBE', 'EXPLAIN', 'USE', 'GRANT', 'REVOKE', 'TRUNCATE',
            'BEGIN', 'COMMIT', 'ROLLBACK', 'SET', 'CALL', 'EXEC', 'WITH'
        ];

        const upperStatement = cleanStatement.toUpperCase();
        return sqlKeywords.some(keyword => upperStatement.startsWith(keyword));
    }
}
