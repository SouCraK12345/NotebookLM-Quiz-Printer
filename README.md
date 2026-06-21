# NotebookLM Quiz Printer

A Chrome Manifest V3 extension that extracts NotebookLM quiz data from `body > app-root` / `data-app-data` and creates an A4 printable worksheet.

## Usage

1. Open `chrome://extensions/` in Chrome.
2. Turn on Developer mode.
3. Click "Load unpacked" and select this folder.
4. Open a NotebookLM quiz page.
5. Click the extension icon and run "Create worksheet".

A print-ready tab opens. Use the toolbar to print or hide/show the answer key.

## Notes

- NotebookLM uses internal page data, so extraction may need updates if the page structure changes.
- The extractor searches recursively for a `quiz` array, so small app data shape changes should still work.
- It attempts to repair common UTF-8 mojibake, but badly damaged source strings may not fully recover.
