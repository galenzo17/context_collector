import * as vscode from 'vscode';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
    const provider = new PromptFileBuilderViewProvider(context.extensionUri, context.subscriptions);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(PromptFileBuilderViewProvider.viewType, provider)
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('promptFileBuilder.copyContent', async (selectedFiles: string[]) => {
             if (!selectedFiles || selectedFiles.length === 0) {
                 vscode.window.showWarningMessage('No files selected.');
                 return;
             }
             await copySelectedFilesContent(selectedFiles);
        })
    );
}

class PromptFileBuilderViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'promptFileBuilderView';
    private _view?: vscode.WebviewView;
    private _extensionSubscriptions: vscode.Disposable[];

    constructor(
        private readonly _extensionUri: vscode.Uri,
        extensionSubscriptions: vscode.Disposable[]
    ) {
        this._extensionSubscriptions = extensionSubscriptions;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'src', 'webview')]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        this.loadFiles(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async message => {
            switch (message.command) {
                case 'copyContent':
                    await copySelectedFilesContent(message.files);
                    return;
                case 'requestFiles':
                    this.loadFiles(webviewView.webview);
                    return;
                case 'showWarning':
                    if (message.text) {
                        vscode.window.showWarningMessage(message.text);
                    }
                    return;
            }
        },
        null,
        this._extensionSubscriptions
        );
    }

    private async loadFiles(webview: vscode.Webview) {
         const workspaceFolders = vscode.workspace.workspaceFolders;
         if (!workspaceFolders) {
             webview.postMessage({ command: 'showError', text: 'No workspace open.' });
             return;
         }

         const files = await vscode.workspace.findFiles('**/*', '{**/node_modules/**,**/.git/**,prompt.txt,**/dist/**,**/build/**}'); // Added common build folders
         const relativeFiles = files.map(file => vscode.workspace.asRelativePath(file)).sort();

         webview.postMessage({ command: 'loadFiles', files: relativeFiles });
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'main.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'style.css'));
        const nonce = getNonce();

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${styleUri}" rel="stylesheet">
                <title>Select Files</title>
            </head>
            <body>
                <input type="text" id="search-box" placeholder="Search files..." aria-label="Search files">
                <div id="file-list-container">
                    <ul id="file-list">
                        <li>Loading files...</li>
                    </ul>
                </div>
                <button id="copy-button">Copy Content to prompt.txt</button>

                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }
}

 async function copySelectedFilesContent(selectedFiles: string[]) {
     const workspaceFolders = vscode.workspace.workspaceFolders;
     if (!workspaceFolders) {
         vscode.window.showErrorMessage('No workspace folder open.');
         return;
     }
     const rootUri = workspaceFolders[0].uri;
     let combinedContent = '';
     const outputFilePath = vscode.Uri.joinPath(rootUri, 'prompt.txt');

     try {
         vscode.window.withProgress({
             location: vscode.ProgressLocation.Notification,
             title: "Generating prompt.txt",
             cancellable: false
         }, async (progress) => {
             progress.report({ increment: 0, message: "Starting..." });
             const totalFiles = selectedFiles.length;
             let processedFiles = 0;

             for (const relativePath of selectedFiles) {
                 const fileUri = vscode.Uri.joinPath(rootUri, relativePath);
                 processedFiles++;
                 const percentage = Math.round((processedFiles / totalFiles) * 100);
                 progress.report({ increment: 100/totalFiles, message: `Processing ${relativePath}... (${percentage}%)` });

                 try {
                     const fileContentBytes = await vscode.workspace.fs.readFile(fileUri);
                     const fileContent = Buffer.from(fileContentBytes).toString('utf8');
                     combinedContent += `--- START FILE: ${relativePath} ---\n\n`;
                     combinedContent += fileContent;
                     combinedContent += `\n\n--- END FILE: ${relativePath} ---\n\n`;
                 } catch (readError: any) {
                     console.error(`Error reading file ${relativePath}:`, readError);
                     combinedContent += `--- ERROR READING FILE: ${relativePath} (${readError.message}) ---\n\n`;
                 }
             }

             progress.report({ increment: 100, message: "Writing prompt.txt..." });
             await vscode.workspace.fs.writeFile(outputFilePath, Buffer.from(combinedContent, 'utf8'));
             vscode.window.showInformationMessage(`Content from ${totalFiles} files copied to prompt.txt`);
         });

     } catch (error: any) {
         console.error('Error writing prompt.txt:', error);
         vscode.window.showErrorMessage(`Failed to write to prompt.txt: ${error.message || error}`);
     }
 }

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

export function deactivate() {}