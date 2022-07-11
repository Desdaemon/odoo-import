import * as vscode from "vscode";

export async function activate(context: vscode.ExtensionContext) {
  const tsExtension = vscode.extensions.getExtension('vscode.typescript-language-features')
  if (!tsExtension) return
  await tsExtension?.activate()

  if (!tsExtension.exports?.getApi) return
  const api = tsExtension.exports.getAPI(0)
  if (!api) return

  const get = vscode.workspace.getConfiguration;

  function refresh() {
    api.configurePlugin('odoo-import', {
      addonDirectories: get('odooImport.addonDirectories')
    })
  }

  refresh();

  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('odooImport')) refresh()
  }))

  console.log(
    'Congratulations, your extension "vscode-odoo-import" is now active!'
  );
}

// this method is called when your extension is deactivated
export function deactivate() { }
