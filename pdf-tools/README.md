# PDF Tools

Merge, split, and compress PDF files directly in your browser. All processing happens locally — your files are never uploaded to any server.

## Features

- **Merge** — Combine multiple PDFs in a custom order with drag-and-drop reordering
- **Split** — Split every page into separate files, or extract custom page ranges (e.g. `1-3, 5, 7-10`)
- **Compress** — Light mode (preserves text) or strong mode (rasterizes pages for larger savings)

## Project Structure

```
pdf-tools/
├── css/
│   └── styles.css
├── js/
│   └── script.js
├── index.html
└── README.md
```

## Usage

1. Open `index.html` in your web browser, or visit [toby2210.github.io/pdf-tools](https://toby2210.github.io/pdf-tools/).
2. Choose a tab: Merge, Split, or Compress.
3. Upload PDF file(s) via drag-and-drop or file picker.
4. Click the action button and download the result.

## Dependencies (CDN)

- [pdf-lib](https://pdf-lib.js.org/) — merge, split, and light compression
- [PDF.js](https://mozilla.github.io/pdf.js/) — strong compression (page rasterization)
- [JSZip](https://stuk.github.io/jszip/) — multi-file ZIP downloads for split

## Limitations

- Encrypted/password-protected PDFs are not supported
- Strong compression converts pages to images — text will not be selectable
- Large files (>50 MB total) may use significant browser memory
