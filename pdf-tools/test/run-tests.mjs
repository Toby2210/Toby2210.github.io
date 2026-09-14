import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import JSZip from "jszip";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "fixtures");

async function makePdf(name, pages) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`Test PDF ${name} page ${i}`, {
      x: 72,
      y: 700,
      size: 18,
      font,
      color: rgb(0, 0, 0),
    });
  }
  const bytes = await doc.save();
  const filePath = path.join(fixturesDir, `${name}.pdf`);
  fs.writeFileSync(filePath, bytes);
  return { filePath, bytes, pages };
}

async function mergePdfs(buffers) {
  const merged = await PDFDocument.create();
  for (const buf of buffers) {
    const src = await PDFDocument.load(buf);
    const indices = Array.from({ length: src.getPageCount() }, (_, i) => i);
    const copied = await merged.copyPages(src, indices);
    copied.forEach((p) => merged.addPage(p));
  }
  return merged.save({ useObjectStreams: true });
}

async function splitEveryPage(buffer) {
  const src = await PDFDocument.load(buffer);
  const outputs = [];
  for (let i = 0; i < src.getPageCount(); i++) {
    const doc = await PDFDocument.create();
    const [page] = await doc.copyPages(src, [i]);
    doc.addPage(page);
    outputs.push(await doc.save());
  }
  return outputs;
}

async function splitRanges(buffer, groups) {
  const src = await PDFDocument.load(buffer);
  const outputs = [];
  for (const indices of groups) {
    const doc = await PDFDocument.create();
    const copied = await doc.copyPages(src, indices);
    copied.forEach((p) => doc.addPage(p));
    outputs.push(await doc.save());
  }
  return outputs;
}

async function lightCompress(buffer) {
  const doc = await PDFDocument.load(buffer);
  return doc.save({ useObjectStreams: true });
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log("PASS:", message);
  } else {
    failed++;
    console.error("FAIL:", message);
  }
}

async function main() {
  fs.mkdirSync(fixturesDir, { recursive: true });

  const a = await makePdf("a", 2);
  const b = await makePdf("b", 3);
  const c = await makePdf("c", 2);

  const merged = await mergePdfs([a.bytes, b.bytes, c.bytes]);
  const mergedDoc = await PDFDocument.load(merged);
  assert(mergedDoc.getPageCount() === 7, "Merge 3 PDFs yields 7 pages");

  const splitPages = await splitEveryPage(b.bytes);
  assert(splitPages.length === 3, "Split every page on 3-page PDF yields 3 files");

  const zip = new JSZip();
  splitPages.forEach((bytes, i) => zip.file(`page-${i + 1}.pdf`, bytes));
  const zipBlob = await zip.generateAsync({ type: "nodebuffer" });
  assert(zipBlob.length > 0, "JSZip produces non-empty archive");

  const rangeOutputs = await splitRanges(b.bytes, [[0, 1], [2]]);
  assert(rangeOutputs.length === 2, "Custom ranges produce 2 outputs");
  const r0 = await PDFDocument.load(rangeOutputs[0]);
  const r1 = await PDFDocument.load(rangeOutputs[1]);
  assert(r0.getPageCount() === 2 && r1.getPageCount() === 1, "Custom range page counts correct");

  const compressed = await lightCompress(b.bytes);
  assert(compressed.byteLength > 0, "Light compress produces output");

  assert(fs.existsSync(path.join(__dirname, "..", "index.html")), "index.html exists");
  assert(fs.existsSync(path.join(__dirname, "..", "css", "styles.css")), "styles.css exists");
  assert(fs.existsSync(path.join(__dirname, "..", "js", "script.js")), "script.js exists");

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
