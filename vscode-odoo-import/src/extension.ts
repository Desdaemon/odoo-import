import * as vscode from "vscode";
import { join } from "path";

export async function activate(context: vscode.ExtensionContext) {
  const tsExtension = vscode.extensions.getExtension("vscode.typescript-language-features");
  if (!tsExtension) return;
  await tsExtension.activate();

  if (!tsExtension.exports?.getAPI) return;
  const api = tsExtension.exports.getAPI(0);
  if (!api) return;

  const channel = vscode.window.createOutputChannel("Odoo Import");
  channel.show();

  let folders: readonly vscode.WorkspaceFolder[] = [];
  function refresh() {
    const root = vscode.workspace.getConfiguration("odooImport");
    folders = vscode.workspace.workspaceFolders || [];
    const addonDirs: string[] = root.get("addonDirectories") || [];
    const addonDirectories = folders.flatMap((folder) => addonDirs.map((dir) => join(folder.uri.fsPath, dir)));
    channel.appendLine(
      JSON.stringify({
        addonDirectories,
      })
    );
    api.configurePlugin("odoo-import", {
      addonDirectories,
    });
  }

  refresh();

  const fspath = (w: vscode.WorkspaceFolder) => w.uri.fsPath;
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("odooImport")) refresh();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders((event) => {
      const current = folders.map(fspath);
      const added = new Set([...event.added.map(fspath), ...current]);
      if (added.size > folders.length) return refresh();

      const removed = new Set(current);
      for (const rem of event.removed) removed.delete(rem.uri.fsPath);
      if (removed.size < folders.length) return refresh();
    })
  );

  vscode.window.setStatusBarMessage("odoo-import is now active.", 1000);
}

// this method is called when your extension is deactivated
export function deactivate() {}
