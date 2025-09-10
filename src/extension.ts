// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as lzma from 'lzma-native';
import * as fs from 'fs';
import * as path from 'path';
import * as tar from 'tar-stream';

class XZFileProvider implements vscode.TextDocumentContentProvider {
	private _onDidChange = new vscode.EventEmitter<vscode.Uri>();

	public async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
		const filePath = uri.fsPath.replace('.xz-view', '');

		try {
			const compressedData = await fs.promises.readFile(filePath);
			const decompressedData = await lzma.decompress(compressedData);

			// Simple .xz file
			if (!filePath.endsWith('.tar.xz')) {
				return decompressedData.toString('utf8');
			}

			// For .tar.xz files, we need to extract the tar content
			const extract = tar.extract();
			let content = '';

			return new Promise<string>((resolve, reject) => {
				extract.on('entry', (header: any, stream: any, next: () => void) => {
					const chunks: Buffer[] = [];
					stream.on('data', (chunk: Buffer) => chunks.push(chunk));
					stream.on('end', () => {
						content += Buffer.concat(chunks).toString('utf8');
						next();
					});
					stream.resume();
				});

				extract.on('finish', () => resolve(content));
				extract.on('error', reject);
				extract.end(decompressedData);
			});
		} catch (error) {
			const errorMsg = `Error processing ${filePath.endsWith('.tar.xz') ? 'TAR.XZ' : 'XZ'} file: ${error}`;
			vscode.window.showErrorMessage(errorMsg);
			return errorMsg;
		}
	}

	get onDidChange(): vscode.Event<vscode.Uri> {
		return this._onDidChange.event;
	}
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	const outputChannel = vscode.window.createOutputChannel("XZ Log Viewer");

	const provider = new XZFileProvider();
	const providerRegistration = vscode.workspace.registerTextDocumentContentProvider('xz-view', provider);

	const openCommand = vscode.commands.registerCommand('xz-log-viewer.openXZFile', async (uri: vscode.Uri) => {
		try {
			if (!uri) {
				const files = await vscode.window.showOpenDialog({
					filters: { 'XZ Files': ['xz'] }
				});
				if (!files || files.length === 0) {
					return;
				}
				uri = files[0];
			}

			outputChannel.appendLine(`Opening: ${uri.fsPath}`);
			const viewUri = uri.with({
				scheme: 'xz-view',
				path: uri.path + '.xz-view'
			});

			const doc = await vscode.workspace.openTextDocument(viewUri);
			await vscode.window.showTextDocument(doc, { preview: false });
		} catch (error) {
			outputChannel.appendLine(`Error opening ${uri?.fsPath}: ${error}`);
			vscode.window.showErrorMessage(`Failed to open XZ file: ${error}`);
		}
	});

	// Register custom editor provider
	const customEditor = vscode.window.registerCustomEditorProvider('xz-log-viewer.xz', {
		async openCustomDocument(uri: vscode.Uri) {
			return { uri, dispose: () => {} };
		},
		async resolveCustomEditor(document: any, webviewPanel: vscode.WebviewPanel) {
			const uri = document.uri.with({
				scheme: 'xz-view',
				path: document.uri.path + '.xz-view'
			});
			// Open in native text editor instead of webview
			const doc = await vscode.workspace.openTextDocument(uri);
			await vscode.window.showTextDocument(doc, {
				viewColumn: webviewPanel.viewColumn,
				preserveFocus: false
			});
			// Close the webview panel since we're using the native editor
			webviewPanel.dispose();
		}
	});

	context.subscriptions.push(providerRegistration, openCommand, customEditor);
}

// This method is called when your extension is deactivated
export function deactivate() {}
