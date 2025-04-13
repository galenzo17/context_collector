import * as vscode from 'vscode';
import * as path from 'node:path';

export function activate(context: vscode.ExtensionContext) {
  const provider = new PromptFileBuilderViewProvider(
    context.extensionUri,
    context.subscriptions
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      PromptFileBuilderViewProvider.viewType,
      provider
    )
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
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this._extensionUri, 'webview'),
        vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview'),
        this._extensionUri
      ],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    this.loadFiles(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'copyContent':
            const promptText = message.prompt || '';
            if (!message.files || message.files.length === 0) {
              vscode.window.showWarningMessage('No files selected.');
              return;
            }
            await copySelectedFilesContent(message.files, promptText);
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
      undefined,
      this._extensionSubscriptions
    );
  }

  private async loadFiles(webview: vscode.Webview) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      webview.postMessage({ command: 'showError', text: 'No workspace open.' });
      return;
    }

    try {
      const excludePattern =
        '**/{node_modules,.git,dist,build,out,vendor,prompt.txt}/**';
      const files = await vscode.workspace.findFiles('**/*', excludePattern);
      const relativeFiles = files
        .map((file) => vscode.workspace.asRelativePath(file))
        .sort();

      webview.postMessage({ command: 'loadFiles', files: relativeFiles });
    } catch (error) {
      console.error('Error finding files:', error);
      webview.postMessage({
        command: 'showError',
        text: 'Error loading files from workspace.',
      });
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    // Intenta diferentes posibles ubicaciones para los recursos
    let scriptUri;
    let styleUri;
    
    try {
      // Intenta primero con rutas relativas a la raíz de la extensión
      scriptUri = webview.asWebviewUri(
        vscode.Uri.joinPath(this._extensionUri, 'webview', 'main.js')
      );
      styleUri = webview.asWebviewUri(
        vscode.Uri.joinPath(this._extensionUri, 'webview', 'style.css')
      );
    } catch (error) {
      try {
        // Intenta con la carpeta dist
        scriptUri = webview.asWebviewUri(
          vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', 'main.js')
        );
        styleUri = webview.asWebviewUri(
          vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', 'style.css')
        );
      } catch (innerError) {
        // Fallback a la estructura original
        scriptUri = webview.asWebviewUri(
          vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'main.js')
        );
        styleUri = webview.asWebviewUri(
          vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'style.css')
        );
      }
    }

    const nonce = getNonce();

    return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${styleUri}" rel="stylesheet">
                <title>Prompt File Builder</title>
            </head>
            <body>
                <div class="prompt-section">
                  <label for="prompt-input">Enter your custom prompt:</label>
                  <textarea id="prompt-input" rows="4" placeholder="Example: Analyze the following code files..."></textarea>
                </div>

                <input type="text" id="search-box" placeholder="Search files..." aria-label="Search files">
                <div id="file-list-container">
                    <ul id="file-list">
                        <li>Loading files...</li>
                    </ul>
                </div>
                <button id="copy-button">Generate prompt.txt</button>

                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
  }
}

async function copySelectedFilesContent(selectedFiles: string[], prompt: string) {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    vscode.window.showErrorMessage('No workspace folder open.');
    return;
  }
  const rootUri = workspaceFolders[0].uri;
  const outputFilePath = vscode.Uri.joinPath(rootUri, 'prompt.txt');

  let combinedContent = '';
  if (prompt && prompt.trim().length > 0) {
    combinedContent += prompt.trim() + '\n\n';
    combinedContent += '--- Files Start Here ---\n\n';
  }

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Generating prompt.txt',
        cancellable: false,
      },
      async (progress) => {
        progress.report({ increment: 0, message: 'Starting...' });
        const totalFiles = selectedFiles.length;
        let processedFiles = 0;

        if (!Array.isArray(selectedFiles)) {
          console.error("selectedFiles is not an array:", selectedFiles);
          vscode.window.showErrorMessage("Internal error: Invalid file list.");
          return;
        }

        for (const relativePath of selectedFiles) {
          if (typeof relativePath !== 'string') {
            console.warn("Skipping invalid file path:", relativePath);
            continue;
          }

          const fileUri = vscode.Uri.joinPath(rootUri, relativePath);
          processedFiles++;
          const percentage = Math.round((processedFiles / totalFiles) * 100);
          progress.report({
            increment: (1 / totalFiles) * 100,
            message: `Processing ${path.basename(relativePath)}... (${percentage}%)`,
          });

          try {
            const fileContentBytes = await vscode.workspace.fs.readFile(
              fileUri
            );
            const fileContent = Buffer.from(fileContentBytes).toString('utf8');
            combinedContent += `--- START FILE: ${relativePath} ---\n\n`;
            combinedContent += fileContent;
            combinedContent += `\n\n--- END FILE: ${relativePath} ---\n\n`;
          } catch (error) {
            console.error(`Error reading file ${relativePath}:`, error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            combinedContent += `--- ERROR READING FILE: ${relativePath} (${errorMessage}) ---\n\n`;
          }
        }

        progress.report({ increment: 100, message: 'Writing prompt.txt...' });
        await vscode.workspace.fs.writeFile(
          outputFilePath,
          Buffer.from(combinedContent, 'utf8')
        );
        vscode.window.showInformationMessage(
          `Content from ${processedFiles} files (out of ${totalFiles} selected) ${prompt ? 'with custom prompt ' : ''}copied to prompt.txt`
        );
      }
    );
  } catch (error) {
    console.error('Error writing prompt.txt:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(
      `Failed to write to prompt.txt: ${errorMessage}`
    );
  }
}

function getNonce() {
  let text = '';
  const possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

export function deactivate() {}