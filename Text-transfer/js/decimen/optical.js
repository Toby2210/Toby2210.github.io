/**
 * Decimen-style optical QR stream for large text payloads.
 * Protocol & fountain code from https://github.com/bashalarmistalt/decimen-optical-transfer (AGPL-3.0).
 * Decoder WASM from the same project's vendored decimen-codec.
 */

import QRCode from 'https://esm.sh/qrcode@1.5.4';
import { LTEncoder, LTDecoder } from './fountain.js';
import {
    packFrame,
    parseFrame,
    classifyFrame,
    streamIdentity,
    fnv1a,
    packFile,
    unpackFile,
    verifyContainer,
    pickFrameBytes,
    blockLength,
    DEFAULT_TX_FPS,
    DEFAULT_FRAME_BYTES
} from './protocol.js';

const CODEC_BASE = 'https://cdn.jsdelivr.net/gh/bashalarmistalt/decimen-optical-transfer@v0.5.3/vendor/decimen-codec/';
const PINNED_MASK = 4;
const QUIET_ZONE = 4;
const TT_JSON_NAME = 'text-transfer.json';
const TT_JSON_TYPE = 'application/vnd.text-transfer+json';

let codecPromise = null;
let sendState = null;
let receiveState = null;

export function shouldUseOpticalTransfer(compressedLength) {
    return compressedLength > 420;
}

async function ensureCodec() {
    if (!codecPromise) {
        codecPromise = (async () => {
            const mod = await import(`${CODEC_BASE}decimen_codec.js`);
            const init = mod.default || mod;
            return init({
                locateFile: (path) => CODEC_BASE + path
            });
        })();
    }
    return codecPromise;
}

function rasterizeQr(moduleCount, modules, margin) {
    const size = moduleCount + 2 * margin;
    const pixels = new Uint32Array(size * size);
    pixels.fill(0xffffffff);
    for (let y = 0; y < moduleCount; y++) {
        const row = (y + margin) * size + margin;
        const src = y * moduleCount;
        for (let x = 0; x < moduleCount; x++) {
            if (modules[src + x]) pixels[row + x] = 0xff000000;
        }
    }
    return { size, pixels };
}

function createFrameQr(bytes, lockedVersion) {
    return QRCode.create([{ data: bytes, mode: 'byte' }], {
        errorCorrectionLevel: 'M',
        version: lockedVersion,
        maskPattern: PINNED_MASK
    });
}

function paintQrToCanvas(canvas, frameBytes, state) {
    const qr = createFrameQr(frameBytes, state.qrVersion);
    if (state.qrVersion == null) state.qrVersion = qr.version;
    const raster = rasterizeQr(qr.modules.size, qr.modules.data, QUIET_ZONE);
    const scale = Math.max(4, Math.floor(Math.min(canvas.width, canvas.height) / raster.size));
    const drawSize = raster.size * scale;
    const offsetX = Math.floor((canvas.width - drawSize) / 2);
    const offsetY = Math.floor((canvas.height - drawSize) / 2);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const img = new ImageData(new Uint8ClampedArray(raster.pixels.buffer), raster.size, raster.size);
    const off = document.createElement('canvas');
    off.width = raster.size;
    off.height = raster.size;
    off.getContext('2d').putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, offsetX, offsetY, drawSize, drawSize);
}

export async function buildOpticalContainerFromPayload(payload) {
    const jsonBytes = new TextEncoder().encode(JSON.stringify(payload));
    const packed = await packFile(TT_JSON_NAME, TT_JSON_TYPE, jsonBytes);
    return packed.container;
}

export async function payloadFromOpticalContainer(container) {
    const ok = await verifyContainer(container);
    if (!ok) throw new Error('Checksum failed');
    const file = await unpackFile(container);
    return JSON.parse(new TextDecoder().decode(file.bytes));
}

export async function startDecimenSend(canvas, payload, callbacks = {}) {
    stopDecimenSend();
    const container = await buildOpticalContainerFromPayload(payload);
    const frameBytes = pickFrameBytes(container.length) || DEFAULT_FRAME_BYTES;
    const blockLen = blockLength(frameBytes);
    const sessionId = (Math.random() * 0xffff) | 0;
    const payloadFnv = fnv1a(container);
    const encoder = new LTEncoder(container, blockLen, sessionId);
    const fps = DEFAULT_TX_FPS;
    let seq = 0;
    let paused = false;
    const state = { qrVersion: null, encoder, sessionId, payloadFnv, blockLen, k: encoder.k, totalLen: container.length };

    const tick = () => {
        if (paused || !sendState) return;
        const block = encoder.encode(seq);
        const header = {
            sessionId,
            seq,
            k: encoder.k,
            blockLen,
            totalLen: container.length,
            payloadFnv,
            flags: 0
        };
        const frame = packFrame(header, block);
        paintQrToCanvas(canvas, frame, state);
        seq++;
        callbacks.onFrame?.({
            seq,
            k: encoder.k,
            blockLen,
            fps
        });
    };

    tick();
    const interval = setInterval(tick, 1000 / fps);
    sendState = { interval, pausedRef: () => paused, setPaused: (v) => { paused = v; } };
    callbacks.onReady?.({ k: encoder.k, frameBytes, fps, blockLen });
    return sendState;
}

export function stopDecimenSend() {
    if (sendState?.interval) clearInterval(sendState.interval);
    sendState = null;
}

export function setDecimenSendPaused(paused) {
    sendState?.setPaused?.(paused);
}

export async function decodeQrBytesFromImageData(codec, imageData) {
    const ptr = codec._malloc(imageData.data.length);
    codec.HEAPU8.set(imageData.data, ptr);
    const results = codec.readFull(ptr, imageData.width, imageData.height, true, 4, false);
    codec._free(ptr);
    const frames = [];
    for (let i = 0; i < results.size(); i++) {
        const r = results.get(i);
        if (r.valid && r.bytes?.length) frames.push(new Uint8Array(r.bytes));
    }
    results.delete();
    return frames;
}

function handleDecimenFrameBytes(bytes, decoderState, onProgress, onComplete) {
    const verdict = classifyFrame(bytes);
    if (verdict.kind !== 'ok') return decoderState;

    const parsed = parseFrame(bytes);
    if (!parsed) return decoderState;

    const { header, block } = parsed;
    const identity = streamIdentity(header);
    if (!decoderState.decoder || decoderState.streamKey !== identity) {
        decoderState.decoder = new LTDecoder(header.k, header.blockLen, header.sessionId, header.totalLen);
        decoderState.streamKey = identity;
    }
    decoderState.decoder.addFrame(header.seq, block);
    const d = decoderState.decoder;
    const useful = d.framesNew - d.framesRedundant;
    onProgress?.({
        usefulFrames: useful,
        k: d.k,
        solved: d.solvedCount,
        redundant: d.framesRedundant
    });

    if (d.isComplete) {
        const assembled = d.assemble();
        if (assembled && fnv1a(assembled) === header.payloadFnv) {
            onComplete?.(assembled);
            decoderState.done = true;
        }
    }
    return decoderState;
}

export async function startDecimenReceive(video, workCanvas, callbacks = {}) {
    stopDecimenReceive();
    const codec = await ensureCodec();
    const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false
    });
    video.srcObject = stream;
    await video.play();

    const ctx = workCanvas.getContext('2d', { willReadFrequently: true });
    let decoderState = { decoder: null, streamKey: null, done: false };
    let raf = 0;
    let lastScan = 0;

    const loop = async (ts) => {
        if (!receiveState || decoderState.done) return;
        if (video.readyState >= 2 && ts - lastScan > 1000 / 20) {
            lastScan = ts;
            workCanvas.width = video.videoWidth;
            workCanvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0);
            const imageData = ctx.getImageData(0, 0, workCanvas.width, workCanvas.height);
            try {
                const frames = await decodeQrBytesFromImageData(codec, imageData);
                for (const bytes of frames) {
                    if (classifyFrame(bytes).kind === 'ok') {
                        decoderState = handleDecimenFrameBytes(bytes, decoderState, callbacks.onProgress, async (container) => {
                            try {
                                const payload = await payloadFromOpticalContainer(container);
                                callbacks.onPayload?.(payload);
                            } catch (err) {
                                callbacks.onError?.(err);
                            }
                        });
                    } else {
                        const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
                        callbacks.onLegacyText?.(text);
                    }
                }
            } catch (err) {
                callbacks.onError?.(err);
            }
        }
        raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    receiveState = { stream, raf, stop: () => { decoderState.done = true; } };
    return receiveState;
}

export function stopDecimenReceive() {
    if (receiveState) {
        cancelAnimationFrame(receiveState.raf);
        receiveState.stream.getTracks().forEach((t) => t.stop());
        receiveState.stop?.();
    }
    receiveState = null;
}

export async function scanDecimenFromImageBitmap(imageData, callbacks = {}) {
    const codec = await ensureCodec();
    let decoderState = { decoder: null, streamKey: null, done: false };
    const frames = await decodeQrBytesFromImageData(codec, imageData);
    for (const bytes of frames) {
        if (classifyFrame(bytes).kind === 'ok') {
            decoderState = handleDecimenFrameBytes(bytes, decoderState, callbacks.onProgress, async (container) => {
                const payload = await payloadFromOpticalContainer(container);
                callbacks.onPayload?.(payload);
            });
        } else {
            callbacks.onLegacyText?.(new TextDecoder().decode(bytes));
        }
    }
}
