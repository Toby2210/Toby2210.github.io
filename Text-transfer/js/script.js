// Text Transfer — static QR, Decimen optical stream, PeerJS pairing

import {
    shouldUseOpticalTransfer,
    startDecimenSend,
    stopDecimenSend,
    setDecimenSendPaused,
    startDecimenReceive,
    stopDecimenReceive,
    scanDecimenFromImageBitmap
} from './decimen/optical.js';

const TT_PROTOCOL = 'ttqr';
const QR_CHUNK_MAX = 420;
const P2P_CHUNK_SIZE = 16000;
const KEY_TTL_SECONDS = 10 * 60;

const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
];

let html5Qrcode = null;
let currentScanMethod = 'camera';
let uploadedFile = null;
let currentFormat = 'plain';
let currentSendMethod = 'qr';
let currentReceiveMode = 'qr';

let qrChunks = [];
let qrChunkIndex = 0;
let qrFlashPaused = false;
let usingOpticalSend = false;
let usingOpticalReceive = false;
const opticalSendCanvas = () => document.getElementById('optical-send-canvas');
let activePairConn = null;
let p2pReceiveBuffer = null;

const qrChunkCollector = new Map();
let expectedQrTotal = 0;

let sendPeer = null;
let receivePeer = null;
let expireTimer = null;
let countdownInterval = null;
let pairSendActive = false;
let pendingPayloadForPair = null;

window.currentScanMethod = currentScanMethod;

const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');
const messageInput = document.getElementById('message-input');
const richEditor = document.getElementById('rich-editor');
const generateQRBtn = document.getElementById('generate-qr');
const generatePairBtn = document.getElementById('generate-pair');
const qrSection = document.getElementById('qr-section');
const qrCodeContainer = document.getElementById('qr-code');
const downloadQrBtn = document.getElementById('download-qr-btn');
const newMessageBtn = document.getElementById('new-message');
const startScannerBtn = document.getElementById('start-scanner');
const scannerContainer = document.getElementById('scanner-container');
const scannerPlaceholder = document.getElementById('scanner-placeholder');
const videoElement = document.getElementById('video');
const scanResult = document.getElementById('scan-result');
const resultContent = document.getElementById('result-content');
const copyResultBtn = document.getElementById('copy-result');
const openCameraBtn = document.getElementById('open-camera-btn');
const cameraScanner = document.getElementById('camera-scanner');
const uploadScanner = document.getElementById('upload-scanner');
const uploadFile = document.getElementById('upload-file');
const uploadPreview = document.getElementById('upload-preview');
const unifiedScanner = document.getElementById('unified-scanner');
const receiveCodeInput = document.getElementById('receive-code');
const receivePairBtn = document.getElementById('receive-pair-btn');
const pairReceiveStatus = document.getElementById('pair-receive-status');
const multiQrProgress = document.getElementById('multi-qr-progress');
const multiQrProgressText = document.getElementById('multi-qr-progress-text');
const resetQrChunksBtn = document.getElementById('reset-qr-chunks');
const qrChunkInfo = document.getElementById('qr-chunk-info');
const qrFlashStatus = document.getElementById('qr-flash-status');
const toggleQrFlashBtn = document.getElementById('toggle-qr-flash');

function generate6DigitCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function getPeerRtcConfig() {
    return { iceServers: ICE_SERVERS, iceCandidatePoolSize: 6 };
}

function stripHtmlToPlain(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    return (div.textContent || div.innerText || '').trim();
}

function buildPayload() {
    if (currentFormat === 'rich') {
        const html = richEditor.innerHTML.trim();
        if (!html || html === '<br>') {
            return null;
        }
        const plain = stripHtmlToPlain(html);
        return { v: 1, f: 'html', h: html, t: plain };
    }
    const text = messageInput.value.trim();
    if (!text) return null;
    return { v: 1, f: 'plain', t: text };
}

function encodePayloadForTransfer(payload) {
    const json = JSON.stringify(payload);
    const compressed = LZString.compressToBase64(json);
    return compressed;
}

function decodeTransferString(encoded) {
    const json = LZString.decompressFromBase64(encoded);
    if (!json) throw new Error('Decompression failed');
    return JSON.parse(json);
}

function splitQrStrings(compressed) {
    if (compressed.length <= QR_CHUNK_MAX) {
        return [`${TT_PROTOCOL}:1:1:${compressed}`];
    }
    const parts = [];
    for (let i = 0; i < compressed.length; i += QR_CHUNK_MAX) {
        parts.push(compressed.slice(i, i + QR_CHUNK_MAX));
    }
    const total = parts.length;
    return parts.map((part, idx) => `${TT_PROTOCOL}:${idx + 1}:${total}:${part}`);
}

function parseQrPayload(decodedText) {
    if (decodedText.startsWith(`${TT_PROTOCOL}:`)) {
        const match = decodedText.match(/^ttqr:(\d+):(\d+):([\s\S]+)$/);
        if (!match) throw new Error('Invalid ttqr format');
        return {
            kind: 'chunk',
            index: parseInt(match[1], 10),
            total: parseInt(match[2], 10),
            part: match[3]
        };
    }
    if (decodedText.startsWith('qrcode://')) {
        const raw = atob(decodedText.substring(9));
        try {
            const parsed = JSON.parse(decodeURIComponent(escape(raw)));
            if (parsed.v && (parsed.f || parsed.t || parsed.h)) {
                return { kind: 'legacy-json', payload: normalizePayload(parsed) };
            }
            if (parsed.content) {
                return { kind: 'legacy-json', payload: { v: 1, f: 'plain', t: String(parsed.content) } };
            }
        } catch {
            /* plain legacy */
        }
        return { kind: 'legacy-json', payload: { v: 1, f: 'plain', t: decodeURIComponent(escape(raw)) } };
    }
    try {
        const raw = atob(decodedText);
        const parsed = JSON.parse(decodeURIComponent(escape(raw)));
        return { kind: 'legacy-json', payload: normalizePayload(parsed) };
    } catch {
        return { kind: 'legacy-json', payload: { v: 1, f: 'plain', t: decodedText } };
    }
}

function normalizePayload(obj) {
    if (obj.f === 'html' || obj.format === 'html') {
        return {
            v: 1,
            f: 'html',
            h: obj.h || obj.html || obj.content || '',
            t: obj.t || obj.text || stripHtmlToPlain(obj.h || obj.html || '')
        };
    }
    return {
        v: 1,
        f: 'plain',
        t: obj.t || obj.text || obj.content || String(obj)
    };
}

function handleCollectedQrPart(index, total, part) {
    if (qrChunkCollector.has(index)) {
        if (qrChunkCollector.size >= total) {
            return finishFromCollector(total);
        }
        return false;
    }
    expectedQrTotal = total;
    qrChunkCollector.set(index, part);
    multiQrProgress.classList.remove('hidden');
    multiQrProgressText.textContent = `Receiving flashing QR… ${qrChunkCollector.size} / ${total} frames captured`;

    if (qrChunkCollector.size < total) {
        if (qrChunkCollector.size === 1) {
            showToast(`Flashing transfer started (${total} frames)`);
        }
        return false;
    }

    return finishFromCollector(total);
}

function finishFromCollector(total) {
    const ordered = [];
    for (let i = 1; i <= total; i++) {
        if (!qrChunkCollector.has(i)) {
            showToast(`Missing QR part ${i} of ${total}`);
            return false;
        }
        ordered.push(qrChunkCollector.get(i));
    }
    resetQrChunkCollection();
    const payload = decodeTransferString(ordered.join(''));
    displayPayload(payload);
    return true;
}

function resetQrChunkCollection() {
    qrChunkCollector.clear();
    expectedQrTotal = 0;
    multiQrProgress.classList.add('hidden');
    multiQrProgressText.textContent = 'Receiving flashing QR… 0 / 0 frames captured';
}

function displayPayload(payload) {
    const normalized = normalizePayload(payload);
    scanResult.style.display = 'block';

    if (normalized.f === 'html') {
        resultContent.className = 'rich-content';
        const clean = DOMPurify.sanitize(normalized.h, {
            USE_PROFILES: { html: true }
        });
        resultContent.innerHTML = clean;
        copyResultBtn.onclick = () => {
            navigator.clipboard.writeText(normalized.t || stripHtmlToPlain(clean)).then(() => {
                showToast('Plain text copied!');
            });
        };
    } else {
        resultContent.className = 'text-content';
        resultContent.innerHTML = `<p>${escapeHtml(normalized.t)}</p>`;
        copyResultBtn.onclick = () => {
            navigator.clipboard.writeText(normalized.t).then(() => {
                showToast('Message copied!');
            });
        };
    }

    if (openCameraBtn && currentScanMethod === 'camera') {
        openCameraBtn.style.display = 'inline-block';
    }
}

function displayResult(text) {
    displayPayload({ v: 1, f: 'plain', t: text });
}

function buildQrCodeInto(element, data) {
    new QRCode(element, {
        text: data,
        width: 280,
        height: 280,
        colorDark: '#1a1a2e',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
    });
}

function stopQrFlash() {
    stopDecimenSend();
    usingOpticalSend = false;
    const canvas = opticalSendCanvas();
    if (canvas) canvas.classList.add('hidden');
    qrCodeContainer.classList.remove('hidden');
}

function setFlashUi(active, label) {
    if (active) {
        qrFlashStatus.classList.remove('hidden');
        qrFlashStatus.textContent = label;
        toggleQrFlashBtn.classList.remove('hidden');
        toggleQrFlashBtn.textContent = qrFlashPaused ? 'Resume flashing' : 'Pause flashing';
    } else {
        qrFlashStatus.classList.add('hidden');
        toggleQrFlashBtn.classList.add('hidden');
    }
}

function renderSingleQr(data) {
    stopQrFlash();
    qrCodeContainer.innerHTML = '';
    qrCodeContainer.dataset.qrData = data;
    buildQrCodeInto(qrCodeContainer, data);
    setFlashUi(false);
    qrChunkInfo.textContent = 'Single QR code — scan once.';
}

async function showGeneratedQr(compressed, payload) {
    qrSection.style.display = 'block';
    document.querySelector('#sender-tab .input-section').style.display = 'none';

    if (shouldUseOpticalTransfer(compressed.length)) {
        usingOpticalSend = true;
        qrFlashPaused = false;
        qrCodeContainer.classList.add('hidden');
        qrCodeContainer.innerHTML = '';
        const canvas = opticalSendCanvas();
        canvas.classList.remove('hidden');
        qrChunks = [];
        await startDecimenSend(canvas, payload, {
            onReady: (info) => {
                qrChunkInfo.textContent =
                    `Decimen fountain stream · ${info.k} source blocks · ${info.fps} fps · ${info.frameBytes} bytes/frame`;
                setFlashUi(true, 'Flashing optical QR — receiver keeps camera on this screen');
            }
        });
        return;
    }

    qrChunks = splitQrStrings(compressed);
    qrChunkIndex = 0;
    renderSingleQr(qrChunks[0]);
}

async function sendPayloadOverConn(conn, payload) {
    const compressed = encodePayloadForTransfer(payload);
    if (compressed.length <= P2P_CHUNK_SIZE) {
        conn.send({ type: 'TEXT_PAYLOAD', encoding: 'lz-base64', data: compressed });
        return;
    }

    const total = Math.ceil(compressed.length / P2P_CHUNK_SIZE);
    conn.send({ type: 'TEXT_BEGIN', total, encoding: 'lz-base64' });
    for (let i = 0; i < total; i++) {
        conn.send({
            type: 'TEXT_CHUNK',
            index: i,
            data: compressed.slice(i * P2P_CHUNK_SIZE, (i + 1) * P2P_CHUNK_SIZE)
        });
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    conn.send({ type: 'TEXT_END' });
}

function payloadFromPairMessage(data) {
    if (!data) return null;
    if (data.encoding === 'lz-base64' && typeof data.data === 'string') {
        return decodeTransferString(data.data);
    }
    if (data.payload) {
        return normalizePayload(data.payload);
    }
    return null;
}

function resetP2pReceiveBuffer() {
    p2pReceiveBuffer = null;
}

function handlePairIncomingData(conn, data) {
    if (data.type === 'TEXT_BEGIN') {
        p2pReceiveBuffer = {
            total: data.total,
            parts: new Array(data.total).fill(null),
            encoding: data.encoding || 'lz-base64'
        };
        pairReceiveStatus.textContent = `Receiving… 0 / ${data.total} parts`;
        return;
    }

    if (data.type === 'TEXT_CHUNK' && p2pReceiveBuffer) {
        p2pReceiveBuffer.parts[data.index] = data.data;
        const received = p2pReceiveBuffer.parts.filter((p) => p != null).length;
        pairReceiveStatus.textContent = `Receiving… ${received} / ${p2pReceiveBuffer.total} parts`;
        return;
    }

    if (data.type === 'TEXT_END' && p2pReceiveBuffer) {
        if (p2pReceiveBuffer.parts.some((p) => p == null)) {
            pairReceiveStatus.textContent = 'Incomplete transfer. Ask sender to try again.';
            resetP2pReceiveBuffer();
            return;
        }
        const joined = p2pReceiveBuffer.parts.join('');
        resetP2pReceiveBuffer();
        const payload = decodeTransferString(joined);
        displayPayload(payload);
        pairReceiveStatus.textContent = 'Text received!';
        conn.send({ type: 'ACK' });
        receiveCodeInput.value = '';
        receivePairBtn.disabled = false;
        return;
    }

    if (data.type === 'TEXT_PAYLOAD') {
        const payload = payloadFromPairMessage(data);
        if (!payload) return;
        displayPayload(payload);
        pairReceiveStatus.textContent = 'Text received!';
        conn.send({ type: 'ACK' });
        receiveCodeInput.value = '';
        receivePairBtn.disabled = false;
    }
}

// --- Format & send method UI ---
document.querySelectorAll('.format-selector .type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.format-selector .type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFormat = btn.dataset.format;
        document.getElementById('plain-input-wrap').classList.toggle('hidden', currentFormat !== 'plain');
        document.getElementById('rich-input-wrap').classList.toggle('hidden', currentFormat !== 'rich');
    });
});

document.querySelectorAll('.send-method-selector .method-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.send-method-selector .method-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentSendMethod = btn.dataset.sendMethod;
        document.getElementById('send-qr-actions').classList.toggle('hidden', currentSendMethod !== 'qr');
        document.getElementById('send-pair-actions').classList.toggle('hidden', currentSendMethod !== 'pair');
    });
});

document.querySelectorAll('.receive-mode-selector .method-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.receive-mode-selector .method-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentReceiveMode = btn.dataset.receiveMode;
        document.getElementById('receive-qr-panel').classList.toggle('hidden', currentReceiveMode !== 'qr');
        document.getElementById('receive-pair-panel').classList.toggle('hidden', currentReceiveMode !== 'pair');
    });
});

document.querySelectorAll('#rich-toolbar .toolbar-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        const cmd = btn.dataset.cmd;
        richEditor.focus();
        document.execCommand(cmd, false, null);
    });
});

// --- Tabs ---
tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        tabBtns.forEach(b => b.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`${tab}-tab`).classList.add('active');

        if (tab !== 'receiver') {
            stopDecimenReceive();
            usingOpticalReceive = false;
            if (html5Qrcode && html5Qrcode.isRunning) {
                html5Qrcode.stop().then(() => { html5Qrcode = null; }).catch(console.error);
            } else {
                html5Qrcode = null;
            }
        }

        if (tab === 'receiver') {
            if (unifiedScanner) unifiedScanner.style.display = currentReceiveMode === 'qr' ? 'block' : 'none';
            if (currentReceiveMode === 'qr') {
                if (currentScanMethod === 'camera') {
                    cameraScanner.style.display = 'block';
                    uploadScanner.style.display = 'none';
                } else {
                    cameraScanner.style.display = 'none';
                    uploadScanner.style.display = 'block';
                }
                startScannerBtn.style.display = currentScanMethod === 'camera' ? 'block' : 'none';
                scannerContainer.style.display = currentScanMethod === 'camera' ? 'block' : 'none';
            }
            if (openCameraBtn) openCameraBtn.style.display = 'none';
            if (scanResult) scanResult.style.display = 'block';
            if (scannerPlaceholder) {
                scannerPlaceholder.style.display = (!html5Qrcode || html5Qrcode.isRunning === false) ? 'block' : 'none';
            }
        } else if (unifiedScanner) {
            unifiedScanner.style.display = 'none';
        }
    });
});

const methodBtns = document.querySelectorAll('#receive-qr-panel .method-selector .method-btn');
methodBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const method = btn.dataset.method;
        methodBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentScanMethod = method;
        window.currentScanMethod = method;

        if (method === 'camera') {
            cameraScanner.style.display = 'block';
            uploadScanner.style.display = 'none';
            if (html5Qrcode && html5Qrcode.isRunning) {
                html5Qrcode.stop().then(() => { html5Qrcode = null; }).catch(console.error);
            } else {
                html5Qrcode = null;
            }
            startScannerBtn.style.display = 'block';
            scannerContainer.style.display = 'block';
            uploadPreview.innerHTML = '';
            uploadFile.value = '';
            uploadedFile = null;
            videoElement.src = '';
            videoElement.pause();
            if (scannerPlaceholder) scannerPlaceholder.style.display = 'block';
            if (openCameraBtn) openCameraBtn.style.display = 'none';
        } else {
            cameraScanner.style.display = 'none';
            uploadScanner.style.display = 'block';
            if (html5Qrcode && html5Qrcode.isRunning) {
                html5Qrcode.stop().then(() => { html5Qrcode = null; }).catch(console.error);
            } else {
                html5Qrcode = null;
            }
            startScannerBtn.style.display = 'none';
            scannerContainer.style.display = 'none';
            videoElement.src = '';
            videoElement.pause();
            if (openCameraBtn) openCameraBtn.style.display = 'none';
        }
    });
});

resetQrChunksBtn.addEventListener('click', () => {
    resetQrChunkCollection();
    showToast('QR collection reset');
});

toggleQrFlashBtn.addEventListener('click', () => {
    qrFlashPaused = !qrFlashPaused;
    if (usingOpticalSend) {
        setDecimenSendPaused(qrFlashPaused);
    }
    toggleQrFlashBtn.textContent = qrFlashPaused ? 'Resume flashing' : 'Pause flashing';
    if (usingOpticalSend && !qrFlashPaused) {
        setFlashUi(true, 'Flashing optical QR — receiver keeps camera on this screen');
    }
});

generateQRBtn.addEventListener('click', async () => {
    const payload = buildPayload();
    if (!payload) {
        showToast('Please enter a message');
        return;
    }
    try {
        const compressed = encodePayloadForTransfer(payload);
        await showGeneratedQr(compressed, payload);
        showToast(shouldUseOpticalTransfer(compressed.length)
            ? 'Decimen optical stream started'
            : 'QR code generated!');
    } catch (error) {
        console.error(error);
        showToast('Failed to generate QR code.');
    }
});

function cleanupPairSend(message = '') {
    if (expireTimer) clearTimeout(expireTimer);
    if (countdownInterval) clearInterval(countdownInterval);
    activePairConn = null;
    if (sendPeer) {
        sendPeer.destroy();
        sendPeer = null;
    }
    pairSendActive = false;
    pendingPayloadForPair = null;
    document.getElementById('pair-send-area').classList.add('hidden');
    generatePairBtn.disabled = false;
    const statusEl = document.getElementById('pair-send-status');
    if (message && statusEl) statusEl.textContent = message;
}

function startPairTimer(seconds) {
    let timeLeft = seconds;
    const timerDisplay = document.getElementById('timer-display');
    if (expireTimer) clearTimeout(expireTimer);
    if (countdownInterval) clearInterval(countdownInterval);

    countdownInterval = setInterval(() => {
        timeLeft--;
        const mins = Math.floor(timeLeft / 60).toString().padStart(2, '0');
        const secs = (timeLeft % 60).toString().padStart(2, '0');
        timerDisplay.textContent = `Expires in: ${mins}:${secs}`;
        if (timeLeft <= 0) clearInterval(countdownInterval);
    }, 1000);

    expireTimer = setTimeout(() => {
        cleanupPairSend('Key expired (10 minutes elapsed).');
    }, seconds * 1000);
}

function startPairSending() {
    const payload = buildPayload();
    if (!payload) {
        showToast('Please enter a message');
        return;
    }

    pendingPayloadForPair = payload;
    generatePairBtn.disabled = true;
    document.getElementById('pair-send-status').textContent = 'Creating session...';

    const passkey = generate6DigitCode();
    if (sendPeer) sendPeer.destroy();

    sendPeer = new Peer(passkey, { config: getPeerRtcConfig() });

    sendPeer.on('open', (id) => {
        document.getElementById('passkey-display').textContent = id;
        document.getElementById('pair-send-area').classList.remove('hidden');
        pairSendActive = true;
        document.getElementById('pair-send-status').textContent = 'Waiting for receiver to connect...';
        startPairTimer(KEY_TTL_SECONDS);
    });

    sendPeer.on('error', (err) => {
        if (err.type === 'unavailable-id') {
            startPairSending();
        } else {
            cleanupPairSend('Connection error: ' + err.message);
        }
    });

    sendPeer.on('connection', (conn) => {
        activePairConn = conn;
        if (expireTimer) clearTimeout(expireTimer);
        if (countdownInterval) clearInterval(countdownInterval);

        conn.on('open', async () => {
            const payload = pendingPayloadForPair;
            if (!payload) return;
            document.getElementById('pair-send-status').textContent = 'Sending text...';
            try {
                await sendPayloadOverConn(conn, payload);
                document.getElementById('pair-send-status').textContent = 'Sent. Waiting for receiver confirmation…';
                conn._ackTimeout = setTimeout(() => {
                    cleanupPairSend('Receiver did not confirm in time.');
                }, 120000);
            } catch (err) {
                console.error(err);
                cleanupPairSend('Send failed: ' + (err.message || err));
            }
        });

        conn.on('data', (data) => {
            if (data && data.type === 'ACK') {
                if (conn._ackTimeout) clearTimeout(conn._ackTimeout);
                cleanupPairSend('Transfer complete! Key destroyed.');
            }
        });

        conn.on('error', (err) => {
            console.error(err);
            document.getElementById('pair-send-status').textContent = 'Connection error during send.';
        });
    });
}

generatePairBtn.addEventListener('click', startPairSending);

receiveCodeInput.addEventListener('input', function () {
    this.value = this.value.replace(/[^0-9]/g, '');
});

receiveCodeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') receivePairBtn.click();
});

receivePairBtn.addEventListener('click', () => {
    const code = receiveCodeInput.value.trim();
    if (code.length !== 6 || isNaN(code)) {
        showToast('Please enter a valid 6-digit key');
        return;
    }

    receivePairBtn.disabled = true;
    pairReceiveStatus.textContent = 'Connecting...';
    resetP2pReceiveBuffer();

    if (receivePeer) receivePeer.destroy();
    receivePeer = new Peer({ config: getPeerRtcConfig() });

    receivePeer.on('open', () => {
        const conn = receivePeer.connect(code, { reliable: true, serialization: 'json' });
        conn.on('open', () => {
            pairReceiveStatus.textContent = 'Connected. Waiting for text...';
        });
        conn.on('data', (data) => {
            if (!data || !data.type) return;
            handlePairIncomingData(conn, data);
            if (data.type === 'TEXT_PAYLOAD' || data.type === 'TEXT_END') {
                setTimeout(() => {
                    if (receivePeer) {
                        receivePeer.destroy();
                        receivePeer = null;
                    }
                }, 800);
            }
        });
        conn.on('error', () => {
            pairReceiveStatus.textContent = 'Connection lost.';
            receivePairBtn.disabled = false;
            resetP2pReceiveBuffer();
        });
        conn.on('close', () => {
            receivePairBtn.disabled = false;
            resetP2pReceiveBuffer();
        });
    });

    receivePeer.on('error', () => {
        pairReceiveStatus.textContent = 'Key invalid or expired.';
        receivePairBtn.disabled = false;
    });
});

downloadQrBtn.addEventListener('click', () => {
    const qrImg = qrCodeContainer.querySelector('img');
    if (qrImg && qrImg.src) {
        const link = document.createElement('a');
        link.href = qrImg.src;
        link.download = `text-transfer-qr-${qrChunkIndex + 1}-of-${qrChunks.length}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast('QR code saved!');
    } else {
        showToast('No QR code to save');
    }
});

newMessageBtn.addEventListener('click', () => {
    stopQrFlash();
    stopDecimenSend();
    qrSection.style.display = 'none';
    document.querySelector('#sender-tab .input-section').style.display = 'block';
    qrCodeContainer.innerHTML = '';
    qrChunks = [];
    messageInput.value = '';
    richEditor.innerHTML = '';
    cleanupPairSend('');
});

uploadFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    uploadedFile = file;
    const reader = new FileReader();
    reader.onload = (event) => {
        uploadPreview.dataset.imageSrc = event.target.result;
        uploadPreview.innerHTML = `
            <img src="${event.target.result}" alt="Uploaded image" style="max-width: 100%; max-height: 300px; display: block; margin-bottom: 15px;">
            <button id="scan-qr-btn" class="primary-btn">Scan QR Code</button>
        `;
    };
    reader.readAsDataURL(file);
});

document.addEventListener('click', (e) => {
    if (e.target.id === 'scan-qr-btn') {
        const imageSrc = uploadPreview.dataset.imageSrc;
        if (imageSrc) {
            e.target.textContent = 'Scanning...';
            e.target.disabled = true;
            scanUploadedImage(imageSrc);
        }
    }
});

function scanUploadedImage(imageSrc) {
    uploadPreview.innerHTML = '<p style="color: white;">Scanning QR code...</p>';

    const restorePreview = () => {
        uploadPreview.dataset.imageSrc = imageSrc;
        uploadPreview.innerHTML = `
            <img src="${imageSrc}" alt="Uploaded image" style="max-width: 100%; max-height: 300px; display: block; margin-bottom: 15px;">
            <button id="scan-qr-btn" class="primary-btn">Scan QR Code</button>
        `;
        uploadFile.value = '';
        uploadedFile = null;
    };

    const img = new Image();
    img.onload = async () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, c.width, c.height);
        let handled = false;
        try {
            await scanDecimenFromImageBitmap(imageData, {
                onPayload: (payload) => {
                    handled = true;
                    displayPayload(payload);
                    uploadPreview.innerHTML = '';
                },
                onLegacyText: (text) => {
                    handled = true;
                    onScanSuccess(text);
                    uploadPreview.innerHTML = '';
                }
            });
        } catch (err) {
            console.error(err);
        }
        if (!handled) {
            showToast('No QR code found (static QR only for uploads; use camera for flashing stream)');
            restorePreview();
        }
    };
    img.onerror = () => {
        showToast('Failed to load image');
        restorePreview();
    };
    img.src = imageSrc;
}

startScannerBtn.addEventListener('click', () => {
    startScannerBtn.style.display = 'none';
    scannerContainer.style.display = 'block';
    if (scannerPlaceholder) scannerPlaceholder.style.display = 'none';
    startScanner();
});

function stopScannerIfRunning() {
    if (html5Qrcode && html5Qrcode.isRunning) {
        return html5Qrcode.stop().then(() => { html5Qrcode = null; }).catch(() => { html5Qrcode = null; });
    }
    html5Qrcode = null;
    return Promise.resolve();
}

function onScanSuccess(decodedText) {
    try {
        const parsed = parseQrPayload(decodedText);
        if (parsed.kind === 'chunk') {
            const done = handleCollectedQrPart(parsed.index, parsed.total, parsed.part);
            if (done) {
                stopScannerIfRunning().then(() => {
                    if (openCameraBtn && currentScanMethod === 'camera') {
                        openCameraBtn.style.display = 'inline-block';
                    }
                });
            }
            return;
        }
        resetQrChunkCollection();
        displayPayload(parsed.payload);
        stopScannerIfRunning().then(() => {
            if (openCameraBtn && currentScanMethod === 'camera') {
                openCameraBtn.style.display = 'inline-block';
            }
        });
    } catch (error) {
        console.error('Decode error:', error, decodedText);
        showToast('Invalid QR code data');
    }
}

function onScanFailure() {}

function restartCamera() {
    stopDecimenReceive();
    usingOpticalReceive = false;
    startScanner();
}

async function startScanner() {
    stopDecimenReceive();
    if (html5Qrcode && html5Qrcode.isRunning) {
        await html5Qrcode.stop().catch(() => {});
        html5Qrcode = null;
    }
    scannerContainer.style.display = 'block';
    videoElement.style.display = 'block';
    usingOpticalReceive = true;
    multiQrProgress.classList.remove('hidden');
    multiQrProgressText.textContent = 'Starting optical decoder…';

    try {
        await startDecimenReceive(videoElement, canvasElement, {
            onProgress: (p) => {
                multiQrProgressText.textContent =
                    `Optical stream · ${p.usefulFrames} useful frames · ${p.solved}/${p.k} blocks recovered`;
            },
            onPayload: (payload) => {
                displayPayload(payload);
                stopDecimenReceive();
                usingOpticalReceive = false;
                multiQrProgressText.textContent = 'Transfer complete';
                if (openCameraBtn) openCameraBtn.style.display = 'inline-block';
                showToast('Text received!');
            },
            onLegacyText: (text) => onScanSuccess(text),
            onError: (err) => {
                console.error(err);
                showToast('Optical decode error');
            }
        });
    } catch (err) {
        console.error(err);
        usingOpticalReceive = false;
        showToast('Failed to start camera. Please allow camera access.');
        if (scannerPlaceholder) scannerPlaceholder.style.display = 'block';
        startScannerBtn.style.display = 'block';
    }
}

openCameraBtn.addEventListener('click', () => {
    if (currentScanMethod === 'camera') restartCamera();
});

window.addEventListener('load', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const encodedData = urlParams.get('data');
    if (encodedData) {
        try {
            const raw = atob(encodedData);
            let payload;
            try {
                payload = normalizePayload(JSON.parse(decodeURIComponent(escape(raw))));
            } catch {
                payload = { v: 1, f: 'plain', t: decodeURIComponent(escape(raw)) };
            }
            displayPayload(payload);
            window.history.replaceState({}, document.title, window.location.pathname);
        } catch (error) {
            console.error(error);
        }
    }
});

function showToast(message) {
    const existingToast = document.querySelector('.toast');
    if (existingToast) existingToast.remove();
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
