// QR Code Message Sender - Main JavaScript

// State management
let html5QrcodeScanner = null;
let currentScanMethod = 'camera'; // 'camera' or 'upload'
let html5Qrcode = null;
let uploadedFile = null; // Store the uploaded file for scanning

// Expose currentScanMethod to window for testing
window.currentScanMethod = currentScanMethod;

// DOM Elements
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');
const messageInput = document.getElementById('message-input');
const generateQRBtn = document.getElementById('generate-qr');
const qrSection = document.getElementById('qr-section');
const qrCodeContainer = document.getElementById('qr-code');
const downloadQrBtn = document.getElementById('download-qr-btn');
const newMessageBtn = document.getElementById('new-message');
const startScannerBtn = document.getElementById('start-scanner');
const scannerContainer = document.getElementById('scanner-container');
const scannerPlaceholder = document.getElementById('scanner-placeholder');
const videoElement = document.getElementById('video');
const canvasElement = document.getElementById('canvas');
const scanResult = document.getElementById('scan-result');
const resultContent = document.getElementById('result-content');
const copyResultBtn = document.getElementById('copy-result');
const openCameraBtn = document.getElementById('open-camera-btn');
const methodBtns = document.querySelectorAll('.method-btn');
const cameraScanner = document.getElementById('camera-scanner');
const uploadScanner = document.getElementById('upload-scanner');
const uploadFile = document.getElementById('upload-file');
const uploadPreview = document.getElementById('upload-preview');
const unifiedScanner = document.getElementById('unified-scanner');

// Tab switching
tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        
        tabBtns.forEach(b => b.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));
        
        btn.classList.add('active');
        document.getElementById(`${tab}-tab`).classList.add('active');
        
        // Stop camera if leaving receiver tab
        if (tab !== 'receiver' && html5Qrcode && html5Qrcode.isRunning) {
            html5Qrcode.stop().then(() => {
                html5Qrcode = null;
            }).catch(err => {
                console.error('Error stopping scanner:', err);
            });
        } else if (tab !== 'receiver' && html5Qrcode) {
            html5Qrcode = null;
        }
        
        // Show camera scanner when entering receiver tab
        if (tab === 'receiver') {
            // Ensure unified scanner is visible
            if (unifiedScanner) {
                unifiedScanner.style.display = 'block';
            }
            // Ensure camera scanner is visible based on current method
            if (currentScanMethod === 'camera') {
                cameraScanner.style.display = 'block';
                uploadScanner.style.display = 'none';
            } else {
                cameraScanner.style.display = 'none';
                uploadScanner.style.display = 'block';
            }
            // Always show start scanner button for camera mode
            startScannerBtn.style.display = currentScanMethod === 'camera' ? 'block' : 'none';
            // Ensure scanner container is visible for camera mode
            scannerContainer.style.display = currentScanMethod === 'camera' ? 'block' : 'none';
            // Hide open camera button when entering receiver tab
            if (openCameraBtn) {
                openCameraBtn.style.display = 'none';
            }
            // Ensure result box is visible
            if (scanResult) {
                scanResult.style.display = 'block';
            }
            // Reset scanner placeholder visibility
            if (scannerPlaceholder) {
                scannerPlaceholder.style.display = (!html5Qrcode || html5Qrcode.isRunning === false) ? 'block' : 'none';
            }
        } else {
            // When leaving receiver tab, hide scanner container
            if (unifiedScanner) {
                unifiedScanner.style.display = 'none';
            }
        }
    });
});

// Scan method switching (camera vs upload)
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
            // Reset scanner state - show start button
            if (html5Qrcode && html5Qrcode.isRunning) {
                html5Qrcode.stop().then(() => {
                    html5Qrcode = null;
                }).catch(err => {
                    console.error('Error stopping scanner:', err);
                });
            } else if (html5Qrcode) {
                html5Qrcode = null;
            }
            // Always show start scanner button
            startScannerBtn.style.display = 'block';
            // Ensure scanner container is visible
            scannerContainer.style.display = 'block';
            // Clear upload preview when switching to camera
            uploadPreview.innerHTML = '';
            uploadFile.value = '';
            uploadedFile = null;
            // Clear video element to ensure fresh start
            videoElement.src = '';
            videoElement.pause();
            // Ensure the scanner placeholder is visible
            if (scannerPlaceholder) {
                scannerPlaceholder.style.display = 'block';
            }
            // Hide open camera button when switching to camera (show start button instead)
            if (openCameraBtn) {
                openCameraBtn.style.display = 'none';
            }
            // Keep scan result visible when switching to camera
            if (scanResult) {
                scanResult.style.display = 'block';
            }
        } else {
            cameraScanner.style.display = 'none';
            uploadScanner.style.display = 'block';
            // Stop camera if running
            if (html5Qrcode && html5Qrcode.isRunning) {
                html5Qrcode.stop().then(() => {
                    html5Qrcode = null;
                }).catch(err => {
                    console.error('Error stopping scanner:', err);
                });
            } else if (html5Qrcode) {
                html5Qrcode = null;
            }
            startScannerBtn.style.display = 'none';
            // Hide scanner container for upload mode
            scannerContainer.style.display = 'none';
            // Hide open camera button when switching to upload
            if (openCameraBtn) {
                openCameraBtn.style.display = 'none';
            }
            // Clear camera video
            videoElement.src = '';
            videoElement.pause();
            // Keep scan result visible when switching to upload
            if (scanResult) {
                scanResult.style.display = 'block';
            }
        }
    });
});

// Upload file for QR scanning
uploadFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        // Store the file object for scanning
        uploadedFile = file;
        
        const reader = new FileReader();
        reader.onload = (event) => {
            // Store the image source for scanning
            uploadPreview.dataset.imageSrc = event.target.result;
            
            // Show image and scan button
            uploadPreview.innerHTML = `
                <img src="${event.target.result}" alt="Uploaded image" style="max-width: 100%; max-height: 300px; display: block; margin-bottom: 15px;">
                <button id="scan-qr-btn" class="primary-btn">Scan QR Code</button>
            `;
        };
        reader.readAsDataURL(file);
    }
});

// Handle scan button click for uploaded image
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

// Scan uploaded image for QR code
function scanUploadedImage(imageSrc) {
    // Create a new scanner instance for this scan
    html5Qrcode = new Html5Qrcode("scanner-container");
    
    // Show scanning state
    uploadPreview.innerHTML = '<p style="color: white;">Scanning QR code...</p>';
    
    // Use the stored file object if available
    if (uploadedFile) {
        html5Qrcode.scanFile(uploadedFile)
            .then(decodedText => {
                // Clear the scanning message
                uploadPreview.innerHTML = '';
                // Remove scan button if it exists
                const scanBtn = document.getElementById('scan-qr-btn');
                if (scanBtn) {
                    scanBtn.remove();
                }
                // Display the result
                onScanSuccess(decodedText);
            })
            .catch(err => {
                console.error('Error scanning uploaded image:', err);
                showToast('No QR code found in the image');
                // Restore the upload preview with image and scan button
                uploadPreview.dataset.imageSrc = imageSrc;
                uploadPreview.innerHTML = `
                    <img src="${imageSrc}" alt="Uploaded image" style="max-width: 100%; max-height: 300px; display: block; margin-bottom: 15px;">
                    <button id="scan-qr-btn" class="primary-btn">Scan QR Code</button>
                `;
                uploadFile.value = '';
                uploadedFile = null;
            });
    } else {
        // Fallback to using the image source
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = function() {
            // Use scanFile with the image element
            html5Qrcode.scanFile(img)
                .then(decodedText => {
                    // Clear the scanning message
                    uploadPreview.innerHTML = '';
                    // Remove scan button if it exists
                    const scanBtn = document.getElementById('scan-qr-btn');
                    if (scanBtn) {
                        scanBtn.remove();
                    }
                    // Display the result
                    onScanSuccess(decodedText);
                })
                .catch(err => {
                    console.error('Error scanning uploaded image:', err);
                    showToast('No QR code found in the image');
                    // Restore the upload preview with image and scan button
                    uploadPreview.dataset.imageSrc = imageSrc;
                    uploadPreview.innerHTML = `
                        <img src="${imageSrc}" alt="Uploaded image" style="max-width: 100%; max-height: 300px; display: block; margin-bottom: 15px;">
                        <button id="scan-qr-btn" class="primary-btn">Scan QR Code</button>
                    `;
                    uploadFile.value = '';
                });
        };
        img.onerror = function() {
            console.error('Failed to load image');
            showToast('Failed to load uploaded image');
            uploadPreview.innerHTML = '';
            uploadFile.value = '';
        };
        img.src = imageSrc;
    }
}


// Generate QR Code
generateQRBtn.addEventListener('click', () => {
    const text = messageInput.value.trim();
    if (!text) {
        showToast('Please enter a message');
        return;
    }
    
    try {
        // Encode text as base64 for QR code
        const encodedData = btoa(unescape(encodeURIComponent(text)));
        // Use a custom protocol format: qrcode://[base64data]
        const qrData = `qrcode://${encodedData}`;
        
        // Generate QR code using qrcode.js
        qrCodeContainer.innerHTML = ''; // Clear previous QR code
        qrCodeContainer.dataset.qrData = qrData; // Store data for copying
        
        // Generate QR code directly without setTimeout
        new QRCode(qrCodeContainer, {
            text: qrData,
            width: 256,
            height: 256,
            colorDark: '#667eea',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.H
        });
        
        // Show QR section
        qrSection.style.display = 'block';
        generateQRBtn.parentElement.style.display = 'none';
        showToast('QR Code generated!');
    } catch (error) {
        console.error('Error generating QR code:', error);
        showToast('Failed to generate QR code.');
    }
});

// Download QR Code button - saves QR code image on click
downloadQrBtn.addEventListener('click', () => {
    const qrImg = qrCodeContainer.querySelector('img');
    if (qrImg && qrImg.src) {
        // Create a temporary link to download the image
        const link = document.createElement('a');
        link.href = qrImg.src;
        link.download = `qrcode-${Date.now()}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast('QR code saved!');
    } else {
        showToast('No QR code to save');
    }
});

// New message
newMessageBtn.addEventListener('click', () => {
    qrSection.style.display = 'none';
    generateQRBtn.parentElement.style.display = 'block';
    qrCodeContainer.innerHTML = '';
    messageInput.value = '';
});

// Start QR Scanner (Camera)
startScannerBtn.addEventListener('click', () => {
    startScannerBtn.style.display = 'none';
    scannerContainer.style.display = 'block';
    startScanner();
});

function onScanSuccess(decodedText, decodedResult) {
    // Stop scanning only if the scanner is actually running
    // Note: scanFile doesn't start the scanner, so we can't stop it
    if (html5Qrcode) {
        // For scanFile (one-time scan), the scanner is never started
        // So we just set it to null without trying to stop
        html5Qrcode = null;
    }
    
    try {
        // Decode the QR code data (handle qrcode:// protocol)
        let decodedData;
        if (decodedText.startsWith('qrcode://')) {
            decodedData = atob(decodedText.substring(9));
        } else {
            decodedData = atob(decodedText);
        }
        // Try to decode as JSON first (backward compatibility), otherwise treat as plain text
        let messageText;
        try {
            const messageData = JSON.parse(decodeURIComponent(escape(decodedData)));
            // If it's a JSON object with content field, use that
            if (messageData.content) {
                messageText = messageData.content;
            } else {
                messageText = decodeURIComponent(escape(decodedData));
            }
        } catch (e) {
            // Not JSON, treat as plain text
            messageText = decodeURIComponent(escape(decodedData));
        }
        
        displayResult(messageText);
    } catch (error) {
        console.error('Decode error:', error);
        console.error('Decoded text:', decodedText);
        showToast('Invalid QR code data');
    }
}

function onScanFailure(error) {
    // Handle scan failure (usually normal during scanning)
    // console.warn(`Scan failure: ${error}`);
}

// Display received result
function displayResult(text) {
    scanResult.style.display = 'block';
    
    // Display the text message
    resultContent.className = 'text-content';
    resultContent.innerHTML = `<p>${escapeHtml(text)}</p>`;
    copyResultBtn.onclick = () => {
        navigator.clipboard.writeText(text).then(() => {
            showToast('Message copied!');
        });
    };
    
    // Show open camera button only when in camera mode
    if (openCameraBtn) {
        if (currentScanMethod === 'camera') {
            openCameraBtn.style.display = 'inline-block';
        } else {
            openCameraBtn.style.display = 'none';
        }
    }
}

// Restart camera function
function restartCamera() {
    // Stop any running scanner
    if (html5Qrcode) {
        html5Qrcode.stop().then(() => {
            html5Qrcode = null;
            startScanner();
        }).catch(err => {
            console.error('Error stopping scanner:', err);
            startScanner();
        });
    } else {
        startScanner();
    }
}

// Start scanner function
function startScanner() {
    const config = {
        fps: 10,
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1.0
    };
    
    html5Qrcode = new Html5Qrcode("scanner-container");
    html5Qrcode.start(
        { facingMode: "environment" },
        config,
        onScanSuccess,
        onScanFailure
    ).catch(err => {
        console.error('Error starting scanner:', err);
        showToast('Failed to start camera. Please allow camera access.');
        if (currentScanMethod === 'camera') {
            const restartBtn = document.getElementById('restart-camera-btn');
            if (restartBtn) {
                restartBtn.style.display = 'inline-block';
            }
        }
    });
}

// Open camera button - restart camera when clicked
openCameraBtn.addEventListener('click', () => {
    // Restart scanner if in camera mode
    if (currentScanMethod === 'camera') {
        restartCamera();
    }
});

// Copy result button
copyResultBtn.addEventListener('click', () => {
    // Handled in displayResult
});

// Check for QR code data in URL on page load
window.addEventListener('load', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const encodedData = urlParams.get('data');
    
    if (encodedData) {
        try {
            const decodedData = atob(encodedData);
            // Try to decode as JSON first (backward compatibility), otherwise treat as plain text
            let messageText;
            try {
                const messageData = JSON.parse(decodeURIComponent(escape(decodedData)));
                // If it's a JSON object with content field, use that
                if (messageData.content) {
                    messageText = messageData.content;
                } else {
                    messageText = decodeURIComponent(escape(decodedData));
                }
            } catch (e) {
                // Not JSON, treat as plain text
                messageText = decodeURIComponent(escape(decodedData));
            }
            displayResult(messageText);
            
            // Remove the parameter from URL
            window.history.replaceState({}, document.title, window.location.pathname);
        } catch (error) {
            console.error('Error processing URL data:', error);
        }
    }
});

// Toast notification
function showToast(message) {
    // Remove existing toast
    const existingToast = document.querySelector('.toast');
    if (existingToast) {
        existingToast.remove();
    }
    
    // Create toast
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    
    // Show toast
    setTimeout(() => toast.classList.add('show'), 10);
    
    // Hide toast
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 2000);
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
