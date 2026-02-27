document.getElementById('generateButton').addEventListener('click', async () => {
    const format = document.getElementById('format').value;
    const sizeValue = parseFloat(document.getElementById('sizeValue').value);
    const unit = document.getElementById('sizeUnit').value;
    const status = document.getElementById('status');

    if (isNaN(sizeValue) || sizeValue <= 0) {
        status.textContent = '請輸入有效大小';
        return;
    }

    // Check for GB limit
    if (unit === 'GB' && sizeValue > 2) {
        status.textContent = '檔案大小上限為 2GB，請輸入更小的值';
        return;
    }

    // Calculate target bytes based on Windows file size calculation (1024-based)
    let targetBytes = sizeValue * (unit === 'KB' ? 1024 : unit === 'MB' ? 1024 ** 2 : 1024 ** 3);
    targetBytes = Math.max(1024, Math.floor(targetBytes)); // Ensure at least 1KB

    status.textContent = `正在生成 ${format.toUpperCase()} ${sizeValue}${unit} (${targetBytes} bytes）...`;
    document.getElementById('generateButton').disabled = true;

    try {
        const mimeType = {
            png: 'image/png',
            jpg: 'image/jpeg',
            gif: 'image/gif',
            pdf: 'application/pdf',
            docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        }[format] || 'application/octet-stream';

        // Generate a generic file with random data
        const chunkSize = 64 * 1024; // 64KB per chunk
        const chunks = Math.ceil(targetBytes / chunkSize);
        const blobParts = [];
        for (let i = 0; i < chunks; i++) {
            const size = Math.min(chunkSize, targetBytes - i * chunkSize);
            const chunk = new Uint8Array(size);
            crypto.getRandomValues(chunk);
            blobParts.push(chunk);
        }
        const blob = new Blob(blobParts, { type: mimeType });

        const filename = `test-${sizeValue}${unit}.${format}`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        // Display success message
        status.textContent = `下載完成：${filename} (實際 ${(blob.size / 1024 / 1024).toFixed(2)} MB)`;
    } catch (err) {
        console.error(err);
        status.textContent = '生成失敗：' + (err.message || '記憶體不足，請減小尺寸或關閉其他分頁');
    } finally {
        document.getElementById('generateButton').disabled = false;
    }
});