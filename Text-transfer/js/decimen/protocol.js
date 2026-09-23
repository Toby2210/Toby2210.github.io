// Decimen wire protocol v3 — subset for Text Transfer (from decimen-optical-transfer shared/protocol.ts)

export const HEADER_LEN = 22;
export const WIRE_VERSION = 3;
const MAGIC0 = 0xd1;
const MAGIC1 = 0xc3;
const CRITICAL_FLAGS = 0x0f;
const SUPPORTED_FLAGS = 0x00;
const FILE_HEADER_LEN = 49;
const FILE_MAGIC = new Uint8Array([0x44, 0x43, 0x46, 0x32]);
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function fnv1a(bytes) {
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) {
        h ^= bytes[i];
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

export function packFrame(h, block) {
    const out = new Uint8Array(HEADER_LEN + block.length);
    const dv = new DataView(out.buffer);
    dv.setUint8(0, MAGIC0);
    dv.setUint8(1, MAGIC1);
    dv.setUint8(2, WIRE_VERSION);
    dv.setUint8(3, h.flags);
    dv.setUint16(4, h.sessionId, true);
    dv.setUint32(6, h.seq, true);
    dv.setUint16(10, h.k, true);
    dv.setUint16(12, h.blockLen, true);
    dv.setUint32(14, h.totalLen, true);
    dv.setUint32(18, h.payloadFnv, true);
    out.set(block, HEADER_LEN);
    return out;
}

export function classifyFrame(bytes) {
    if (bytes.length < 4 || bytes[0] !== MAGIC0) return { kind: 'foreign' };
    if (bytes[1] !== MAGIC1) return { kind: 'foreign' };
    const version = bytes[2];
    if (version !== WIRE_VERSION) return { kind: 'foreign' };
    const unknownCritical = bytes[3] & CRITICAL_FLAGS & ~SUPPORTED_FLAGS;
    if (unknownCritical !== 0) return { kind: 'unsupported-flags', flags: unknownCritical };
    if (bytes.length <= HEADER_LEN) return { kind: 'malformed' };
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const k = dv.getUint16(10, true);
    const blockLen = dv.getUint16(12, true);
    const totalLen = dv.getUint32(14, true);
    if (k === 0 || blockLen === 0 || totalLen === 0) return { kind: 'malformed' };
    if (bytes.length !== HEADER_LEN + blockLen) return { kind: 'malformed' };
    return { kind: 'ok' };
}

export function parseFrame(bytes) {
    if (classifyFrame(bytes).kind !== 'ok') return null;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const header = {
        sessionId: dv.getUint16(4, true),
        seq: dv.getUint32(6, true),
        k: dv.getUint16(10, true),
        blockLen: dv.getUint16(12, true),
        totalLen: dv.getUint32(14, true),
        payloadFnv: dv.getUint32(18, true),
        flags: dv.getUint8(3)
    };
    return { header, block: bytes.subarray(HEADER_LEN) };
}

export function streamIdentity(h) {
    const critical = h.flags & CRITICAL_FLAGS;
    return `${h.sessionId}:${h.k}:${h.blockLen}:${h.totalLen}:${h.payloadFnv}:${critical}`;
}

async function digest(bytes) {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

async function gzipAsync(bytes) {
    const compressed = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(compressed).arrayBuffer());
}

async function gunzipAsync(bytes, maxBytes) {
    const inflated = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const reader = inflated.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > maxBytes) {
            await reader.cancel();
            throw new Error('inflate overflow');
        }
        chunks.push(value);
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
    }
    return out;
}

function safeFileName(name) {
    const base = name.split(/[\\/]/).pop() ?? '';
    const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
    return cleaned === '' || cleaned === '.' || cleaned === '..' ? 'transfer.bin' : cleaned;
}

export async function packFile(name, type, bytes) {
    const nameBytes = textEncoder.encode(safeFileName(name));
    const typeBytes = textEncoder.encode(type || 'application/octet-stream');
    const tryGzip = bytes.length >= 768;
    const sha256 = await digest(bytes);
    let transmitted = bytes;
    let compression = 'none';
    if (tryGzip) {
        const gz = await gzipAsync(bytes);
        if (gz.length + 64 < bytes.length) {
            transmitted = gz;
            compression = 'gzip';
        }
    }
    const out = new Uint8Array(FILE_HEADER_LEN + nameBytes.length + typeBytes.length + transmitted.length);
    const view = new DataView(out.buffer);
    out.set(FILE_MAGIC, 0);
    view.setUint8(4, compression === 'gzip' ? 1 : 0);
    view.setUint16(5, nameBytes.length, true);
    view.setUint16(7, typeBytes.length, true);
    view.setUint32(9, bytes.length, true);
    view.setUint32(13, transmitted.length, true);
    out.set(sha256, 17);
    out.set(nameBytes, FILE_HEADER_LEN);
    out.set(typeBytes, FILE_HEADER_LEN + nameBytes.length);
    out.set(transmitted, FILE_HEADER_LEN + nameBytes.length + typeBytes.length);
    return { container: out, compression };
}

export async function unpackFile(container) {
    if (container.length < FILE_HEADER_LEN) throw new Error('container truncated');
    for (let i = 0; i < FILE_MAGIC.length; i++) {
        if (container[i] !== FILE_MAGIC[i]) throw new Error('bad magic');
    }
    const view = new DataView(container.buffer, container.byteOffset, container.byteLength);
    const compressionByte = view.getUint8(4);
    const nameLength = view.getUint16(5, true);
    const typeLength = view.getUint16(7, true);
    const fileLength = view.getUint32(9, true);
    const transmittedLength = view.getUint32(13, true);
    const dataOffset = FILE_HEADER_LEN + nameLength + typeLength;
    const transmitted = container.slice(dataOffset);
    let bytes = transmitted;
    if (compressionByte === 1) {
        bytes = await gunzipAsync(transmitted, fileLength);
    }
    if (bytes.length !== fileLength) throw new Error('length mismatch');
    return {
        name: safeFileName(textDecoder.decode(container.subarray(FILE_HEADER_LEN, FILE_HEADER_LEN + nameLength))),
        type: textDecoder.decode(container.subarray(FILE_HEADER_LEN + nameLength, dataOffset)) || 'application/octet-stream',
        sha256: container.slice(17, 49),
        bytes
    };
}

export async function verifyContainer(container) {
    const file = await unpackFile(container);
    const actual = await digest(file.bytes);
    return actual.every((v, i) => v === file.sha256[i]);
}

export const FRAME_BYTES_OPTIONS = [500, 1000, 1465, 1850, 2331, 2953];
export const DEFAULT_TX_FPS = 24;
export const DEFAULT_FRAME_BYTES = 1465;

export function blockLength(frameBytes) {
    return frameBytes - HEADER_LEN;
}

export function pickFrameBytes(containerLength) {
    for (const fb of FRAME_BYTES_OPTIONS) {
        const k = Math.ceil(containerLength / blockLength(fb));
        if (k <= 0xffff) return fb;
    }
    return FRAME_BYTES_OPTIONS[FRAME_BYTES_OPTIONS.length - 1];
}
