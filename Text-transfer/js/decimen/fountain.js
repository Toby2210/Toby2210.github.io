// Decimen fountain codec (wire v2 carousel) — ported from decimen-optical-transfer shared/fountain.ts

export function dlog(x) {
    let e = 0;
    let m = x;
    while (m >= 1.5) { m /= 2; e++; }
    while (m < 0.75) { m *= 2; e--; }
    const z = (m - 1) / (m + 1);
    const z2 = z * z;
    let term = z;
    let sum = 0;
    for (let n = 1; n <= 21; n += 2) {
        sum += term / n;
        term *= z2;
    }
    return e * 0.6931471805599453 + 2 * sum;
}

const SOLITON_C = 0.1;
const SOLITON_DELTA = 0.5;
const REPAIR_DEGREE_MIN = 4;
const REPAIR_DEGREE_MAX = 24;

export function splitmix32(seed) {
    let s = seed | 0;
    return () => {
        s = (s + 0x9e3779b9) | 0;
        let t = s ^ (s >>> 16);
        t = Math.imul(t, 0x21f0aaad);
        t ^= t >>> 15;
        t = Math.imul(t, 0x735a2d97);
        t ^= t >>> 15;
        return t >>> 0;
    };
}

function frameSeed(sessionId, seq) {
    let h = (Math.imul(sessionId + 1, 0x9e3779b1) ^ (seq + 0x85ebca6b)) | 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return (h ^ (h >>> 16)) | 0;
}

export function cycleLength(k) {
    return 2 * k;
}

function repairIndices(k, sessionId, seq) {
    const rnd = splitmix32(frameSeed(sessionId, seq));
    const d = Math.min(k, REPAIR_DEGREE_MIN + (rnd() % (REPAIR_DEGREE_MAX - REPAIR_DEGREE_MIN + 1)));
    const set = new Set();
    while (set.size < d) set.add(rnd() % k);
    return [...set];
}

export function frameComposition(k, sessionId, seq) {
    const pos = seq % cycleLength(k);
    return pos < k ? [pos] : repairIndices(k, sessionId, seq);
}

export class LTEncoder {
    constructor(payload, blockLen, sessionId) {
        this.blockLen = blockLen;
        this.sessionId = sessionId;
        this.k = Math.max(1, Math.ceil(payload.length / blockLen));
        this.words = Math.ceil(blockLen / 4);
        this.blocks = new Uint32Array(this.k * this.words);
        const bytes = new Uint8Array(this.blocks.buffer);
        for (let b = 0; b < this.k; b++) {
            const src = payload.subarray(b * blockLen, Math.min((b + 1) * blockLen, payload.length));
            bytes.set(src, b * this.words * 4);
        }
    }

    encode(seq) {
        const idx = frameComposition(this.k, this.sessionId, seq);
        const out = new Uint32Array(this.words);
        for (const b of idx) {
            const off = b * this.words;
            for (let w = 0; w < this.words; w++) {
                out[w] = (out[w] ^ this.blocks[off + w]) >>> 0;
            }
        }
        return new Uint8Array(out.buffer, 0, this.blockLen);
    }
}

export class LTDecoder {
    constructor(k, blockLen, sessionId, totalLen) {
        this.k = k;
        this.blockLen = blockLen;
        this.sessionId = sessionId;
        this.totalLen = totalLen;
        this.words = Math.ceil(blockLen / 4);
        this.solved = new Array(k).fill(null);
        this.byBlock = new Map();
        this.seen = new Set();
        this.solvedCount = 0;
        this.framesNew = 0;
        this.framesDup = 0;
        this.framesRedundant = 0;
    }

    get isComplete() {
        return this.solvedCount >= this.k;
    }

    addFrame(seq, block) {
        if (this.seen.has(seq)) {
            this.framesDup++;
            return;
        }
        this.seen.add(seq);
        this.framesNew++;
        if (this.isComplete) return;

        const idx = new Set(frameComposition(this.k, this.sessionId, seq));
        const words = new Uint32Array(this.words);
        new Uint8Array(words.buffer).set(block.subarray(0, this.blockLen));
        for (const b of [...idx]) {
            const s = this.solved[b];
            if (s) {
                for (let w = 0; w < this.words; w++) words[w] = (words[w] ^ s[w]) >>> 0;
                idx.delete(b);
            }
        }
        if (idx.size === 0) {
            this.framesRedundant++;
            return;
        }
        if (idx.size === 1) {
            this.resolve(idx.values().next().value, words);
            return;
        }
        const pf = { idx, words };
        for (const b of idx) {
            let set = this.byBlock.get(b);
            if (!set) {
                set = new Set();
                this.byBlock.set(b, set);
            }
            set.add(pf);
        }
    }

    resolve(b0, w0) {
        const queue = [[b0, w0]];
        while (queue.length) {
            const [b, w] = queue.pop();
            if (this.solved[b]) continue;
            this.solved[b] = w;
            this.solvedCount++;
            const waiting = this.byBlock.get(b);
            if (!waiting) continue;
            this.byBlock.delete(b);
            for (const pf of waiting) {
                for (let i = 0; i < this.words; i++) pf.words[i] = (pf.words[i] ^ w[i]) >>> 0;
                pf.idx.delete(b);
                if (pf.idx.size === 1) {
                    const r = pf.idx.values().next().value;
                    this.byBlock.get(r)?.delete(pf);
                    if (!this.solved[r]) queue.push([r, pf.words]);
                }
            }
        }
    }

    assemble() {
        if (!this.isComplete) return null;
        const out = new Uint8Array(this.totalLen);
        for (let b = 0; b < this.k; b++) {
            const start = b * this.blockLen;
            const len = Math.min(this.blockLen, this.totalLen - start);
            if (len > 0) out.set(new Uint8Array(this.solved[b].buffer, 0, len), start);
        }
        return out;
    }
}
