# Markdown Table Tools

English | [日本語](README.ja.md)

Edit Markdown tables directly in a full-width preview, with sorting, filtering, and automatic saving.

![Edit cells directly and move to the next cell with Tab](images/demo-edit.gif)

## Installation

- **VS Code**: Search for “Markdown Table Tools” in the Marketplace.
- **Windsurf / Devin Desktop and other compatible editors**: Install from Open VSX.

To build a VSIX locally, run `npm ci && npm run package`, then use **Install from VSIX** in your editor.

## Usage

Open a Markdown file and press `Ctrl+Alt+V` (`Cmd+Alt+V` on macOS), or run **Open Table Preview** from the Command Palette.

## Features

- **Edit cells directly**: Click a cell in the preview. Press `Enter` to confirm, `Esc` to cancel, or `Shift+Enter` to insert a line break (saved as `<br>`). Use `Tab` / `Shift+Tab` to confirm and edit the next / previous cell.
- **Keyboard navigation**: Select a cell, move with the arrow keys, and press `Enter` to edit.
- **Undo / redo**: Use `Ctrl+Z` / `Ctrl+Shift+Z` (or `Ctrl+Y`) in the preview.
- **Add or delete rows and columns**: Right-click a table cell to open the context menu.
- **Sort**: Click a header to cycle through ascending, descending, and original order.
- **Filter columns**: Type in the inputs below the headers. Sorting and filtering only affect the display; they do not modify the source.
- **Auto-save**: Edits are saved automatically by default.
- **Markdown rendering**: Reuses the editor's Markdown preview assets for Mermaid, math (KaTeX), relative images, and links.
- **Scroll synchronization**: The editor and preview follow each other.

Adding or deleting a column clears sorting and filters so that conditions are not applied to a different column.

### Sorting, filtering, and table operations

![Sort, filter, and add rows and columns](images/demo-operations.gif)

### Mermaid, math, images, and scroll synchronization

![Preview diagrams, math, and images with synchronized scrolling](images/demo-preview.gif)

The recorded demos use the Japanese interface.

## Display language

Commands, settings, menus, and notifications follow the VS Code display language. English and Japanese are supported; other languages use English. Restart VS Code after changing its display language.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `mdTableTools.autoSave` | `true` | Automatically save table edits. |
| `mdTableTools.openIn` | `"active"` | Open in the current editor group; use `"beside"` to split to the right. |

Scroll synchronization follows the built-in `markdown.preview.scrollEditorWithPreview` and `markdown.preview.scrollPreviewWithEditor` settings.

## Compatibility

Designed for VS Code and compatible editors such as Windsurf and Devin Desktop. Mermaid, math, and standard styles depend on the Markdown extensions bundled with the editor. A basic display is used when those assets are unavailable.

The built-in Markdown preview supports sorting and filtering. Use **Open Table Preview** to edit cells.

## Development and verification

Run `npm ci` to install dependencies, then:

- `npm test`: unit tests.
- `npm run test:integration`: Extension Host tests using an installed VS Code.
- `npm run package -- --out extension.vsix`: build a VSIX.
- `npm run test:vsix -- extension.vsix`: install and test the packaged extension in an isolated profile.
- `npm run test:e2e`: interact with the actual VS Code UI and check the saved Markdown.

Set `VSCODE_BIN` to the VS Code executable if it is not at the default location. Integration and UI tests use English by default; `MDT_TEST_LOCALE` selects another locale. Japanese UI tests also need the Japanese language pack installed in each isolated test profile before launch (for example, using a `VSCODE_BIN` wrapper). On headless Linux, run UI-dependent tests under a virtual display such as Xvfb.

See the [verification notes](docs/verification.md) (Japanese) for scope and limitations. Recorded results do not imply verification of every editor or version.

## Releases (maintainers)

After obtaining user approval, update the version and changelog and push the corresponding tag. GitHub Actions runs tests and VSIX checks before publishing to both registries and creating a GitHub Release. See the [release instructions](docs/release.md) (Japanese) for required secrets and troubleshooting.

## License

MIT
