/* global PDFLib, pdfjsLib, JSZip */

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const LARGE_FILE_WARNING_BYTES = 50 * 1024 * 1024;

// --- Shared helpers ---

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsArrayBuffer(file);
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function setStatus(message, isError = false) {
  const el = document.getElementById("status");
  el.textContent = message;
  el.classList.toggle("error", isError);
}

function setProgress(visible, value = 0) {
  const el = document.getElementById("progress");
  el.hidden = !visible;
  el.value = value;
}

function validatePdfFile(file) {
  if (!file) return "No file selected.";
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return "Please upload a PDF file.";
  }
  return null;
}

async function loadPdfDocument(arrayBuffer) {
  try {
    const doc = await PDFLib.PDFDocument.load(arrayBuffer, { ignoreEncryption: false });
    return doc;
  } catch (err) {
    const msg = err && err.message ? err.message.toLowerCase() : "";
    if (msg.includes("encrypt") || msg.includes("password")) {
      throw new Error("Encrypted PDFs are not supported.");
    }
    throw new Error("Could not read PDF. The file may be corrupted or invalid.");
  }
}

async function getPageCount(arrayBuffer) {
  const doc = await loadPdfDocument(arrayBuffer);
  return doc.getPageCount();
}

function setupDropZone(dropZone, fileInput, onFiles) {
  dropZone.addEventListener("click", () => fileInput.click());

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("dragover");
  });

  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("dragover");
  });

  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    onFiles(Array.from(e.dataTransfer.files));
  });

  fileInput.addEventListener("change", () => {
    onFiles(Array.from(fileInput.files));
    fileInput.value = "";
  });
}

function setProcessing(isProcessing) {
  document.querySelectorAll(".primary-btn").forEach((btn) => {
    btn.disabled = isProcessing || btn.dataset.ready === "false";
  });
}

function baseName(filename) {
  return filename.replace(/\.pdf$/i, "");
}

// --- Tab switching ---

const tabs = document.querySelectorAll(".tab");
const panels = document.querySelectorAll(".panel");

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const target = tab.dataset.tab;
    tabs.forEach((t) => {
      t.classList.toggle("active", t === tab);
      t.setAttribute("aria-selected", t === tab ? "true" : "false");
    });
    panels.forEach((p) => {
      const isActive = p.id === `panel-${target}`;
      p.classList.toggle("active", isActive);
      p.hidden = !isActive;
    });
    setStatus("");
    setProgress(false);
  });
});

// --- Merge ---

const mergeFiles = [];
let mergeDragId = null;

const mergeDropZone = document.getElementById("mergeDropZone");
const mergeFileInput = document.getElementById("mergeFileInput");
const mergeFileList = document.getElementById("mergeFileList");
const mergeButton = document.getElementById("mergeButton");
const mergeHint = document.getElementById("mergeHint");

function updateMergeUI() {
  mergeFileList.innerHTML = "";

  mergeFiles.forEach((entry, index) => {
    const li = document.createElement("li");
    li.className = "file-item";
    li.draggable = true;
    li.dataset.id = entry.id;

    li.innerHTML = `
      <span class="drag-handle" title="Drag to reorder">&#9776;</span>
      <div class="file-details">
        <div class="file-name">${escapeHtml(entry.name)}</div>
        <div class="file-meta">${formatFileSize(entry.size)}${entry.pageCount != null ? ` · ${entry.pageCount} page${entry.pageCount !== 1 ? "s" : ""}` : ""}</div>
      </div>
      <button type="button" class="remove-btn" data-index="${index}">Remove</button>
    `;

    li.addEventListener("dragstart", () => {
      mergeDragId = entry.id;
      li.classList.add("dragging");
    });

    li.addEventListener("dragend", () => {
      mergeDragId = null;
      li.classList.remove("dragging");
    });

    li.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (!mergeDragId || mergeDragId === entry.id) return;
      const fromIdx = mergeFiles.findIndex((f) => f.id === mergeDragId);
      const toIdx = mergeFiles.findIndex((f) => f.id === entry.id);
      if (fromIdx === -1 || toIdx === -1) return;
      const [moved] = mergeFiles.splice(fromIdx, 1);
      mergeFiles.splice(toIdx, 0, moved);
      updateMergeUI();
    });

    li.querySelector(".remove-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      mergeFiles.splice(index, 1);
      updateMergeUI();
    });

    mergeFileList.appendChild(li);
  });

  const totalSize = mergeFiles.reduce((sum, f) => sum + f.size, 0);
  const ready = mergeFiles.length >= 2 && mergeFiles.every((f) => f.pageCount != null);
  mergeButton.disabled = !ready;
  mergeButton.dataset.ready = ready ? "true" : "false";

  if (mergeFiles.length === 0) {
    mergeHint.textContent = "Add at least 2 PDF files to merge.";
  } else if (mergeFiles.length === 1) {
    mergeHint.textContent = "Add one more PDF file to merge.";
  } else if (totalSize > LARGE_FILE_WARNING_BYTES) {
    mergeHint.textContent = `Total size is ${formatFileSize(totalSize)}. Large files may use significant memory.`;
  } else {
    mergeHint.textContent = `${mergeFiles.length} files ready to merge. Drag to reorder.`;
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

async function addMergeFiles(files) {
  for (const file of files) {
    const err = validatePdfFile(file);
    if (err) {
      setStatus(err, true);
      continue;
    }

    const id = crypto.randomUUID();
    const entry = { id, file, name: file.name, size: file.size, pageCount: null };
    mergeFiles.push(entry);
    updateMergeUI();

    try {
      setStatus(`Reading ${file.name}...`);
      const buf = await readFileAsArrayBuffer(file);
      entry.pageCount = await getPageCount(buf);
      updateMergeUI();
    } catch (e) {
      const idx = mergeFiles.findIndex((f) => f.id === id);
      if (idx !== -1) mergeFiles.splice(idx, 1);
      setStatus(e.message, true);
      updateMergeUI();
    }
  }
  if (mergeFiles.length > 0 && !document.getElementById("status").classList.contains("error")) {
    setStatus("");
  }
}

setupDropZone(mergeDropZone, mergeFileInput, addMergeFiles);

mergeButton.addEventListener("click", async () => {
  if (mergeFiles.length < 2) return;

  setProcessing(true);
  setProgress(true, 0);
  setStatus("Merging PDFs...");

  try {
    const mergedPdf = await PDFLib.PDFDocument.create();
    const total = mergeFiles.length;

    for (let i = 0; i < total; i++) {
      const entry = mergeFiles[i];
      setProgress(true, Math.round(((i + 0.5) / total) * 100));
      setStatus(`Merging ${entry.name} (${i + 1}/${total})...`);

      const buf = await readFileAsArrayBuffer(entry.file);
      const src = await loadPdfDocument(buf);
      const pageCount = src.getPageCount();
      const pageIndices = Array.from({ length: pageCount }, (_, idx) => idx);
      const copied = await mergedPdf.copyPages(src, pageIndices);
      copied.forEach((page) => mergedPdf.addPage(page));
    }

    const bytes = await mergedPdf.save({ useObjectStreams: true });
    downloadBlob(new Blob([bytes], { type: "application/pdf" }), "merged.pdf");
    setProgress(true, 100);
    setStatus("Merge complete! Download started.");
  } catch (e) {
    setStatus(e.message || "Merge failed.", true);
  } finally {
    setProcessing(false);
    setTimeout(() => setProgress(false), 800);
  }
});

// --- Split ---

let splitFile = null;
let splitPageCount = 0;

const splitDropZone = document.getElementById("splitDropZone");
const splitFileInput = document.getElementById("splitFileInput");
const splitFileInfo = document.getElementById("splitFileInfo");
const splitButton = document.getElementById("splitButton");
const splitCustomGroup = document.getElementById("splitCustomGroup");
const splitRanges = document.getElementById("splitRanges");
const splitModeRadios = document.querySelectorAll('input[name="splitMode"]');

function updateSplitUI() {
  const ready = splitFile && splitPageCount > 0;
  splitButton.disabled = !ready;
  splitButton.dataset.ready = ready ? "true" : "false";

  if (splitFile) {
    splitFileInfo.classList.remove("hidden");
    splitFileInfo.textContent = `${splitFile.name} — ${formatFileSize(splitFile.size)} — ${splitPageCount} page${splitPageCount !== 1 ? "s" : ""}`;
  } else {
    splitFileInfo.classList.add("hidden");
  }
}

splitModeRadios.forEach((radio) => {
  radio.addEventListener("change", () => {
    splitCustomGroup.classList.toggle("hidden", radio.value !== "custom" || !radio.checked);
    if (radio.value === "custom" && radio.checked) {
      splitCustomGroup.classList.remove("hidden");
    }
  });
});

async function setSplitFile(file) {
  const err = validatePdfFile(file);
  if (err) {
    setStatus(err, true);
    return;
  }

  try {
    setStatus(`Reading ${file.name}...`);
    const buf = await readFileAsArrayBuffer(file);
    splitPageCount = await getPageCount(buf);
    splitFile = file;
    updateSplitUI();
    setStatus("");
  } catch (e) {
    splitFile = null;
    splitPageCount = 0;
    updateSplitUI();
    setStatus(e.message, true);
  }
}

setupDropZone(splitDropZone, splitFileInput, (files) => {
  if (files[0]) setSplitFile(files[0]);
});

function parsePageRangeGroups(input, totalPages) {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Please enter page ranges.");

  const groups = [];
  const parts = trimmed.split(",").map((s) => s.trim()).filter(Boolean);

  for (const part of parts) {
    let indices;
    if (part.includes("-")) {
      const [startStr, endStr] = part.split("-").map((s) => s.trim());
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (isNaN(start) || isNaN(end) || start < 1 || end > totalPages || start > end) {
        throw new Error(`Invalid range: ${part}`);
      }
      indices = Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i);
    } else {
      const page = parseInt(part, 10);
      if (isNaN(page) || page < 1 || page > totalPages) {
        throw new Error(`Invalid page: ${part}`);
      }
      indices = [page - 1];
    }
    groups.push(indices);
  }

  return groups;
}

async function createPdfFromPages(sourceDoc, pageIndices) {
  const newDoc = await PDFLib.PDFDocument.create();
  const copied = await newDoc.copyPages(sourceDoc, pageIndices);
  copied.forEach((page) => newDoc.addPage(page));
  return newDoc.save({ useObjectStreams: true });
}

splitButton.addEventListener("click", async () => {
  if (!splitFile) return;

  setProcessing(true);
  setProgress(true, 0);
  setStatus("Splitting PDF...");

  try {
    const buf = await readFileAsArrayBuffer(splitFile);
    const sourceDoc = await loadPdfDocument(buf);
    const mode = document.querySelector('input[name="splitMode"]:checked').value;
    const base = baseName(splitFile.name);

    if (mode === "every") {
      const zip = new JSZip();
      for (let i = 0; i < splitPageCount; i++) {
        setProgress(true, Math.round(((i + 0.5) / splitPageCount) * 100));
        setStatus(`Splitting page ${i + 1}/${splitPageCount}...`);
        const bytes = await createPdfFromPages(sourceDoc, [i]);
        zip.file(`${base}-page-${i + 1}.pdf`, bytes);
      }
      const zipBlob = await zip.generateAsync({ type: "blob" });
      downloadBlob(zipBlob, `${base}-split-pages.zip`);
      setStatus(`Split complete! ${splitPageCount} files in ZIP.`);
    } else {
      const groups = parsePageRangeGroups(splitRanges.value, splitPageCount);

      if (groups.length === 1) {
        const bytes = await createPdfFromPages(sourceDoc, groups[0]);
        downloadBlob(new Blob([bytes], { type: "application/pdf" }), `${base}-split.pdf`);
        setStatus("Split complete! Download started.");
      } else {
        const zip = new JSZip();
        for (let i = 0; i < groups.length; i++) {
          setProgress(true, Math.round(((i + 0.5) / groups.length) * 100));
          setStatus(`Creating output ${i + 1}/${groups.length}...`);
          const bytes = await createPdfFromPages(sourceDoc, groups[i]);
          const label = groups[i].length === 1
            ? `page-${groups[i][0] + 1}`
            : `pages-${groups[i][0] + 1}-${groups[i][groups[i].length - 1] + 1}`;
          zip.file(`${base}-${label}.pdf`, bytes);
        }
        const zipBlob = await zip.generateAsync({ type: "blob" });
        downloadBlob(zipBlob, `${base}-split.zip`);
        setStatus(`Split complete! ${groups.length} files in ZIP.`);
      }
    }

    setProgress(true, 100);
  } catch (e) {
    setStatus(e.message || "Split failed.", true);
  } finally {
    setProcessing(false);
    setTimeout(() => setProgress(false), 800);
  }
});

// --- Compress ---

let compressFile = null;

const compressDropZone = document.getElementById("compressDropZone");
const compressFileInput = document.getElementById("compressFileInput");
const compressFileInfo = document.getElementById("compressFileInfo");
const compressButton = document.getElementById("compressButton");
const compressResult = document.getElementById("compressResult");
const compressDpiGroup = document.getElementById("compressDpiGroup");
const compressDpi = document.getElementById("compressDpi");
const compressModeRadios = document.querySelectorAll('input[name="compressMode"]');

function updateCompressUI() {
  const ready = !!compressFile;
  compressButton.disabled = !ready;
  compressButton.dataset.ready = ready ? "true" : "false";

  if (compressFile) {
    compressFileInfo.classList.remove("hidden");
    compressFileInfo.textContent = `${compressFile.name} — ${formatFileSize(compressFile.size)}`;
  } else {
    compressFileInfo.classList.add("hidden");
  }
  compressResult.classList.add("hidden");
}

compressModeRadios.forEach((radio) => {
  radio.addEventListener("change", () => {
    compressDpiGroup.classList.toggle("hidden", radio.value !== "strong" || !radio.checked);
    if (radio.value === "strong" && radio.checked) {
      compressDpiGroup.classList.remove("hidden");
    }
  });
});

async function setCompressFile(file) {
  const err = validatePdfFile(file);
  if (err) {
    setStatus(err, true);
    return;
  }

  try {
    setStatus(`Reading ${file.name}...`);
    const buf = await readFileAsArrayBuffer(file);
    await getPageCount(buf);
    compressFile = file;
    updateCompressUI();
    setStatus("");
  } catch (e) {
    compressFile = null;
    updateCompressUI();
    setStatus(e.message, true);
  }
}

setupDropZone(compressDropZone, compressFileInput, (files) => {
  if (files[0]) setCompressFile(files[0]);
});

function canvasToJpegBytes(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Failed to render page."));
          return;
        }
        blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf))).catch(reject);
      },
      "image/jpeg",
      quality
    );
  });
}

async function strongCompress(arrayBuffer, dpi) {
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;
  const newPdf = await PDFLib.PDFDocument.create();
  const scale = dpi / 72;
  const quality = dpi >= 150 ? 0.85 : dpi >= 100 ? 0.75 : 0.65;

  for (let i = 1; i <= pdf.numPages; i++) {
    setProgress(true, Math.round(((i - 0.5) / pdf.numPages) * 100));
    setStatus(`Rasterizing page ${i}/${pdf.numPages}...`);

    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport }).promise;

    const jpegBytes = await canvasToJpegBytes(canvas, quality);
    const image = await newPdf.embedJpg(jpegBytes);
    const pdfPage = newPdf.addPage([viewport.width, viewport.height]);
    pdfPage.drawImage(image, {
      x: 0,
      y: 0,
      width: viewport.width,
      height: viewport.height,
    });
  }

  return newPdf.save({ useObjectStreams: true });
}

compressButton.addEventListener("click", async () => {
  if (!compressFile) return;

  setProcessing(true);
  setProgress(true, 0);
  setStatus("Compressing PDF...");

  try {
    const buf = await readFileAsArrayBuffer(compressFile);
    const mode = document.querySelector('input[name="compressMode"]:checked').value;
    let bytes;

    if (mode === "light") {
      const doc = await loadPdfDocument(buf);
      bytes = await doc.save({ useObjectStreams: true });
    } else {
      const dpi = parseInt(compressDpi.value, 10);
      bytes = await strongCompress(buf, dpi);
    }

    const originalSize = compressFile.size;
    const newSize = bytes.byteLength;
    const savings = originalSize > 0 ? ((1 - newSize / originalSize) * 100).toFixed(1) : "0.0";
    const filename = `${baseName(compressFile.name)}-compressed.pdf`;

    downloadBlob(new Blob([bytes], { type: "application/pdf" }), filename);

    compressResult.classList.remove("hidden");
    compressResult.innerHTML = `
      <div>Original: ${formatFileSize(originalSize)}</div>
      <div>Compressed: ${formatFileSize(newSize)}</div>
      <div class="savings">${newSize < originalSize ? `Saved ${savings}%` : newSize > originalSize ? `File grew by ${Math.abs(parseFloat(savings)).toFixed(1)}% (light mode has limited effect on some PDFs)` : "No size change"}</div>
    `;

    setProgress(true, 100);
    setStatus("Compression complete! Download started.");
  } catch (e) {
    setStatus(e.message || "Compression failed.", true);
  } finally {
    setProcessing(false);
    setTimeout(() => setProgress(false), 800);
  }
});
