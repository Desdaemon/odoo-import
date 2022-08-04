## vscode-odoo-import

Enable Odoo module discovery and autocompletions.

Odoo's internal JavaScript codebase dates before the standardization of ES6 modules, so some wiring is required to make things visible to TypeScript. This includes:

- Parsing @odoo-module pragmas and rerouting imports
- Rewriting classic imports to be understood as proper modules (in-progress!)
- Injecting module completions for great profit

It is still very barebones right now with no customizations yet, so file an issue or let me know of what doesn't work or is missing!

### Extension Settings

Todo!

### Known Issues

Multiple classic modules in one file are not entirely supported right now (i.e. `odoo.define('foo')` modules)

### Release Notes

#### 0.0.1

## Release Notes

### 0.1.0

- Add `addonDirectories` configuration
- Enable extension for JavaScript-only projects

### 0.0.1

Initial release
