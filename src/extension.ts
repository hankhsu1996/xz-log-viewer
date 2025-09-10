import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as lzma from 'lzma-native';
import * as tar from 'tar-stream';

const MAX_PREVIEW_BYTES = 50 * 1024 * 1024; // 50MB

/** Utility: close the custom editor tab for a given URI */
async function closeTabByUri(uri: vscode.Uri, viewType: string) {
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input: any = tab.input;
      if (
        input?.viewType === viewType &&
        input?.uri?.toString?.() === uri.toString()
      ) {
        await vscode.window.tabGroups.close(tab);
        return;
      }
    }
  }
}

/** Utility: check if file exists */
async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Decompress to disk only; do not open the result */
async function handleLargeXZFile(
  filePath: string,
  decompressedData: Buffer,
  currentTabUri?: vscode.Uri,
): Promise<boolean> {
  // Build output path: /path/foo.log.xz -> /path/foo.log
  const outPath = filePath.replace(/\.xz$/, '');
  const fileName = path.basename(outPath);
  const sizeMB = Math.round(decompressedData.length / 1024 / 1024);

  // Ask user
  const choice = await vscode.window.showWarningMessage(
    `This file is too large to preview (${sizeMB}MB). Do you want to decompress it to ${fileName}?`,
    'Decompress',
    'Cancel',
  );
  if (choice !== 'Decompress') {
    // Optional: close the empty .xz tab on cancel
    if (currentTabUri) {
      for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
          const input: any = tab.input;
          if (
            input?.viewType === 'xz-log-viewer.xz' &&
            input?.uri?.toString?.() === currentTabUri.toString()
          ) {
            await vscode.window.tabGroups.close(tab);
            break;
          }
        }
      }
    }
    return false;
  }

  // Overwrite check
  try {
    await fs.promises.access(outPath);
    const overwrite = await vscode.window.showWarningMessage(
      `File ${fileName} already exists. Overwrite?`,
      'Overwrite',
      'Cancel',
    );
    if (overwrite !== 'Overwrite') {
      return false;
    }
  } catch {
    // file does not exist; proceed
  }

  // Write decompressed bytes
  await fs.promises.writeFile(outPath, decompressedData);

  // Inform user; no auto-open
  vscode.window.showInformationMessage(`Decompressed to ${fileName}.`);

  // Close the .xz custom editor tab so the user isn't left on a blank view
  if (currentTabUri) {
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input: any = tab.input;
        if (
          input?.viewType === 'xz-log-viewer.xz' &&
          input?.uri?.toString?.() === currentTabUri.toString()
        ) {
          await vscode.window.tabGroups.close(tab);
          break;
        }
      }
    }
  }

  return true;
}

/** Provides text for xz-view: URIs */
class XZFileProvider implements vscode.TextDocumentContentProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  get onDidChange(): vscode.Event<vscode.Uri> {
    return this._onDidChange.event;
  }

  public async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    // map …/file.log.xz-view -> …/file.log.xz
    const filePath = uri.fsPath.replace(/\.xz-view$/, '');

    try {
      const compressed = await fs.promises.readFile(filePath);
      const decompressed = await lzma.decompress(compressed);

      if (!filePath.endsWith('.tar.xz')) {
        return decompressed.toString('utf8');
      }

      // handle .tar.xz
      const extract = tar.extract();
      let content = '';
      return await new Promise<string>((resolve, reject) => {
        extract.on('entry', (_header: any, stream: any, next: () => void) => {
          const chunks: Buffer[] = [];
          stream.on('data', (c: Buffer) => chunks.push(c));
          stream.on('end', () => {
            content += Buffer.concat(chunks).toString('utf8');
            next();
          });
          stream.resume();
        });
        extract.on('finish', () => resolve(content));
        extract.on('error', reject);
        extract.end(decompressed);
      });
    } catch (err) {
      const msg = `Error processing ${filePath.endsWith('.tar.xz') ? 'TAR.XZ' : 'XZ'} file: ${err}`;
      vscode.window.showErrorMessage(msg);
      return msg;
    }
  }
}

/** Extension entry */
export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('XZ Log Viewer');

  // register provider
  const provider = new XZFileProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('xz-view', provider),
  );

  // register custom editor
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider('xz-log-viewer.xz', {
      async openCustomDocument(uri: vscode.Uri) {
        return { uri, dispose: () => {} };
      },

      async resolveCustomEditor(
        document: any,
        webviewPanel: vscode.WebviewPanel,
      ) {
        try {
          const filePath = document.uri.fsPath;
          const compressed = await fs.promises.readFile(filePath);
          const decompressed = await lzma.decompress(compressed);

          if (decompressed.length > MAX_PREVIEW_BYTES) {
            await handleLargeXZFile(filePath, decompressed, document.uri);
            return;
          }

          const viewUri = document.uri.with({
            scheme: 'xz-view',
            path: document.uri.path + '.xz-view',
          });
          const vdoc = await vscode.workspace.openTextDocument(viewUri);
          await vscode.window.showTextDocument(vdoc, {
            viewColumn: webviewPanel.viewColumn,
            preview: false,
          });
          await closeTabByUri(document.uri, 'xz-log-viewer.xz');
        } catch (err) {
          output.appendLine(`Failed to open XZ: ${err}`);
          vscode.window.showErrorMessage(`Failed to open XZ: ${err}`);
          await closeTabByUri(document.uri, 'xz-log-viewer.xz');
        }
      },
    }),
  );
}

export function deactivate() {}
