const videoUpload = document.getElementById("videoUpload");
const videoPlayer = document.getElementById("videoPlayer");
const cutButton = document.getElementById("cutButton");
const downloadButton = document.getElementById("downloadButton");
const previewButton = document.getElementById("previewButton");
const resetButton = document.getElementById("resetButton");
const startTimeLabel = document.getElementById("startTimeLabel");
const endTimeLabel = document.getElementById("endTimeLabel");

const progressBar = document.querySelector(".progress-bar");
const rangeBar = document.querySelector(".range-bar");
const startHandle = document.querySelector(".range-handle-start");
const endHandle = document.querySelector(".range-handle-end");

let videoDuration = 0;
let startTime = 0;
let endTime = 0;
let cutBlob = null;
let isDragging = false;
let currentDragHandle = null; // Track which handle is being dragged

// Load video
videoUpload.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (file) {
        const url = URL.createObjectURL(file);
        videoPlayer.src = url;

        // Ensure metadata is loaded before accessing video duration
        videoPlayer.addEventListener("loadedmetadata", () => {
            videoDuration = videoPlayer.duration;
            endTime = videoDuration;
            startTime = 0;
            updateRangeBar();
        });
    }
});

// Update range bar and labels
function updateRangeBar() {
    if (videoDuration === 0) return;

    const startPercent = (startTime / videoDuration) * 100;
    const endPercent = (endTime / videoDuration) * 100;

    rangeBar.style.left = `${startPercent}%`;
    rangeBar.style.width = `${endPercent - startPercent}%`;

    // Only update the handle that is not being dragged to prevent jump
    if (currentDragHandle !== startHandle) {
        startHandle.style.left = `${startPercent}%`;
    }
    if (currentDragHandle !== endHandle) {
        endHandle.style.left = `${endPercent}%`;
    }

    startTimeLabel.textContent = `Start: ${startTime.toFixed(2)}s`;
    endTimeLabel.textContent = `End: ${endTime.toFixed(2)}s`;
}

// Drag handles
function updateDragPosition(clientX) {
    if (!currentDragHandle || videoDuration === 0) return;

    const rect = progressBar.getBoundingClientRect();
    let offsetX = clientX - rect.left;
    // Clamp to progress bar bounds
    offsetX = Math.max(0, Math.min(rect.width, offsetX));

    const percent = offsetX / rect.width;
    const time = percent * videoDuration;

    if (currentDragHandle === startHandle) {
        // Ensure start time is less than end time
        startTime = Math.min(time, endTime - 0.1);
    } else {
        // Ensure end time is greater than start time
        endTime = Math.max(time, startTime + 0.1);
    }

    updateRangeBar();
}

function stopDrag() {
    isDragging = false;
    currentDragHandle = null;
    document.removeEventListener("mousemove", onDocumentMouseMove);
    document.removeEventListener("mouseup", stopDrag);
}

const onDocumentMouseMove = (event) => {
    updateDragPosition(event.clientX);
};

// Add event listeners for dragging handles
startHandle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    isDragging = true;
    currentDragHandle = startHandle;
    
    // Use requestAnimationFrame to ensure getBoundingClientRect is accurate
    requestAnimationFrame(() => {
        const rect = progressBar.getBoundingClientRect();
        const offsetX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
        const percent = offsetX / rect.width;
        const time = percent * videoDuration;
        startTime = Math.min(time, endTime - 0.1);
        
        // Update all positions
        const startPercent = (startTime / videoDuration) * 100;
        const endPercent = (endTime / videoDuration) * 100;
        startHandle.style.left = `${startPercent}%`;
        endHandle.style.left = `${endPercent}%`;
        rangeBar.style.left = `${startPercent}%`;
        rangeBar.style.width = `${endPercent - startPercent}%`;
        startTimeLabel.textContent = `Start: ${startTime.toFixed(2)}s`;
        endTimeLabel.textContent = `End: ${endTime.toFixed(2)}s`;
    });
    
    document.addEventListener("mousemove", onDocumentMouseMove);
    document.addEventListener("mouseup", stopDrag);
});

endHandle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    isDragging = true;
    currentDragHandle = endHandle;
    
    // Use requestAnimationFrame to ensure getBoundingClientRect is accurate
    requestAnimationFrame(() => {
        const rect = progressBar.getBoundingClientRect();
        const offsetX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
        const percent = offsetX / rect.width;
        const time = percent * videoDuration;
        endTime = Math.max(time, startTime + 0.1);
        
        // Update all positions
        const startPercent = (startTime / videoDuration) * 100;
        const endPercent = (endTime / videoDuration) * 100;
        startHandle.style.left = `${startPercent}%`;
        endHandle.style.left = `${endPercent}%`;
        rangeBar.style.left = `${startPercent}%`;
        rangeBar.style.width = `${endPercent - startPercent}%`;
        startTimeLabel.textContent = `Start: ${startTime.toFixed(2)}s`;
        endTimeLabel.textContent = `End: ${endTime.toFixed(2)}s`;
    });
    
    document.addEventListener("mousemove", onDocumentMouseMove);
    document.addEventListener("mouseup", stopDrag);
});

// Update range when video plays
const handleVideoTimeUpdate = () => {
    if (videoDuration > 0 && videoPlayer.currentTime > 0 && !isDragging && !isPreviewing) {
        // Only update if user hasn't manually set a range
        if (startTime === 0 && endTime === videoDuration) {
            startTime = videoPlayer.currentTime;
            endTime = videoPlayer.currentTime;
            updateRangeBar();
        }
    }
};
videoPlayer.addEventListener("timeupdate", handleVideoTimeUpdate);

// Auto-preview before video playback
let autoPreviewHandler = null;
let previewTimeUpdateHandler = null;
let isPreviewing = false;

videoPlayer.addEventListener("play", () => {
    if (videoDuration > 0 && !isPreviewing && !isDragging) {
        // Remove any existing preview timeupdate handler
        if (previewTimeUpdateHandler) {
            videoPlayer.removeEventListener("timeupdate", previewTimeUpdateHandler);
        }
        
        // Seek to start time
        videoPlayer.currentTime = startTime;
        isPreviewing = true;
        
        // Stop playing when we reach the end time
        autoPreviewHandler = () => {
            if (videoPlayer.currentTime >= endTime) {
                videoPlayer.pause();
                isPreviewing = false;
                if (autoPreviewHandler) {
                    videoPlayer.removeEventListener("timeupdate", autoPreviewHandler);
                    autoPreviewHandler = null;
                }
            }
        };
        videoPlayer.addEventListener("timeupdate", autoPreviewHandler);
    }
});

// Preview selected range
previewButton.addEventListener("click", () => {
    if (videoDuration === 0) {
        alert("Please upload a video first.");
        return;
    }
    
    if (startTime >= endTime) {
        alert("Invalid range. Please select a valid range.");
        return;
    }
    
    // Remove any existing preview timeupdate handler
    if (previewTimeUpdateHandler) {
        videoPlayer.removeEventListener("timeupdate", previewTimeUpdateHandler);
    }
    
    // Remove any existing auto-preview handler
    if (autoPreviewHandler) {
        videoPlayer.removeEventListener("timeupdate", autoPreviewHandler);
        autoPreviewHandler = null;
    }
    
    // Seek to start time and play
    videoPlayer.currentTime = startTime;
    isPreviewing = true;
    videoPlayer.play();
    
    // Stop playing when we reach the end time
    previewTimeUpdateHandler = () => {
        if (videoPlayer.currentTime >= endTime) {
            videoPlayer.pause();
            isPreviewing = false;
        }
    };
    videoPlayer.addEventListener("timeupdate", previewTimeUpdateHandler);
});

// Reset selection
resetButton.addEventListener("click", () => {
    // Remove any existing preview timeupdate handler
    if (previewTimeUpdateHandler) {
        videoPlayer.removeEventListener("timeupdate", previewTimeUpdateHandler);
        previewTimeUpdateHandler = null;
    }
    
    // Remove any existing auto-preview handler
    if (autoPreviewHandler) {
        videoPlayer.removeEventListener("timeupdate", autoPreviewHandler);
        autoPreviewHandler = null;
    }
    
    startTime = 0;
    endTime = videoDuration;
    updateRangeBar();
    
    // Reset video to beginning
    videoPlayer.currentTime = 0;
    isPreviewing = false;
});

// Cut video
cutButton.addEventListener("click", () => {
    if (startTime >= endTime) {
        alert("Invalid range. Please select a valid range.");
        return;
    }

    const file = videoUpload.files[0];
    if (!file) {
        alert("Please upload a video first.");
        return;
    }

    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.src = url;
    video.muted = true;
    video.crossOrigin = "anonymous";
    video.playsInline = true;

    video.addEventListener("loadedmetadata", () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        // Detect original video FPS by measuring frame updates
        let frameCount = 0;
        let lastTime = video.currentTime;
        let detectedFPS = 30; // Default fallback
        
        const fpsMonitor = () => {
            const currentTime = video.currentTime;
            const timeDiff = currentTime - lastTime;
            if (timeDiff >= 0.5) { // Measure over at least 0.5 seconds
                detectedFPS = Math.round(frameCount / timeDiff);
                // Ensure reasonable FPS range
                detectedFPS = Math.max(15, Math.min(detectedFPS, 60));
            }
            frameCount++;
            lastTime = currentTime;
        };

        // Use the canvas stream for recording with detected FPS
        const stream = canvas.captureStream(detectedFPS);
        
        // Try to use the best available codec with high quality
        const availableCodecs = [
            "video/webm;codecs=vp9,opus",
            "video/webm;codecs=vp8,opus",
            "video/webm;codecs=h264,opus",
            "video/webm;codecs=avc1.42E01E,opus",
            "video/webm"
        ];
        
        let selectedMimeType = "video/webm";
        for (const codec of availableCodecs) {
            if (MediaRecorder.isTypeSupported(codec)) {
                selectedMimeType = codec;
                break;
            }
        }
        
        const mediaRecorder = new MediaRecorder(stream, { 
            mimeType: selectedMimeType,
            videoBitsPerSecond: 5000000 // 5 Mbps for high quality
        });
        const chunks = [];

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                chunks.push(event.data);
            }
        };

        mediaRecorder.onstop = () => {
            const blob = new Blob(chunks, { type: selectedMimeType });
            cutBlob = blob;

            const cutUrl = URL.createObjectURL(blob);
            videoPlayer.src = cutUrl;
            videoPlayer.load();

            downloadButton.style.display = "inline-block";
            downloadButton.onclick = () => {
                const a = document.createElement("a");
                a.href = cutUrl;
                a.download = "cut-video.webm";
                a.click();
            };
        };

        // Seek to start time and start recording
        video.currentTime = startTime;
        mediaRecorder.start();

        // Track when we've reached the end time
        let reachedEnd = false;
        
        video.addEventListener("timeupdate", function onTimeUpdate() {
            // Monitor FPS during playback
            fpsMonitor();
            
            if (video.currentTime >= endTime && !reachedEnd) {
                reachedEnd = true;
                
                // Capture the final frame
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                
                // Stop recording after a short delay to ensure final frames are captured
                setTimeout(() => {
                    mediaRecorder.stop();
                    video.removeEventListener("timeupdate", onTimeUpdate);
                }, 100);
            } else if (!reachedEnd) {
                // Capture frame at current time
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            }
        });

        // Play the video to capture frames
        video.play();
    });
});
