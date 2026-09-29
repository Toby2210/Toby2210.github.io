(function () {
    'use strict';

    const I18n = window.VisionAudioI18n;
    const t = I18n.t;

    const versionMeta = document.querySelector('meta[name="version"]');
    const versionEl = document.getElementById('app-version');
    if (versionMeta && versionEl) {
        versionEl.textContent = 'v' + versionMeta.content;
    }

    const langToggle = document.getElementById('lang-toggle');
    const modeRadios = document.querySelectorAll('input[name="capture-mode"]');
    const loopbackWrap = document.getElementById('loopback-wrap');
    const loopbackSelect = document.getElementById('loopback-device');
    const refreshDevicesBtn = document.getElementById('refresh-devices');
    const sensitivityInput = document.getElementById('sensitivity');
    const sensitivityValue = document.getElementById('sensitivity-value');
    const startBtn = document.getElementById('start-btn');
    const stopBtn = document.getElementById('stop-btn');
    const statusMessage = document.getElementById('status-message');
    const activityBadge = document.getElementById('activity-badge');
    const volumeNowDb = document.getElementById('volume-now-db');
    const levelText = document.getElementById('level-text');
    const peakDbText = document.getElementById('peak-db-text');
    const meterFill = document.getElementById('meter-fill');
    const waveformCanvas = document.getElementById('waveform');
    const spectrumCanvas = document.getElementById('spectrum');
    const sourcePanel = document.getElementById('source-panel');
    const sourceType = document.getElementById('source-type');
    const sourceLabel = document.getElementById('source-label');
    const sourceAudioTracks = document.getElementById('source-audio-tracks');
    const ratePanel = document.getElementById('rate-panel');
    const rateCapture = document.getElementById('rate-capture');
    const rateContext = document.getElementById('rate-context');
    const rateChannels = document.getElementById('rate-channels');
    const rateSpectrum = document.getElementById('rate-spectrum');
    const ratePeak = document.getElementById('rate-peak');
    const rateOutput = document.getElementById('rate-output');
    const captureKeepalive = document.getElementById('capture-keepalive');
    const meterReadingInput = document.getElementById('meter-reading');
    const applyCalBtn = document.getElementById('apply-cal-btn');
    const calAnchor85Btn = document.getElementById('cal-anchor-85');
    const calAnchor100Btn = document.getElementById('cal-anchor-100');
    const presetDeviceSelect = document.getElementById('preset-device');
    const presetVolumeInput = document.getElementById('preset-volume');
    const presetVolumeValue = document.getElementById('preset-volume-value');
    const applyPresetCalBtn = document.getElementById('apply-preset-cal');
    const calStatus = document.getElementById('cal-status');
    const whoVerdictEl = document.getElementById('who-verdict');
    const whoVerdictText = document.getElementById('who-verdict-text');

    let audioContext = null;
    let analyser = null;
    let mediaStream = null;
    let animationId = null;
    let timeDomainBuffer = null;
    let freqBuffer = null;
    let badgeState = 'idle';
    let lastSourceStream = null;
    let sessionPeakDb = -Infinity;
    let sessionMaxRmsDb = -Infinity;
    let lastRmsDb = null;
    let lastPeakDb = null;
    let splRefAtZeroDbfs = null;

    const LOOPBACK_LABEL_PATTERN = /stereo mix|what u hear|wave out|\bcable\b|loopback|vb-audio|virtual/i;

    const PRESET_MAX_DBA = {
        inear: 106,
        overear: 100,
        speaker: 92,
        laptop: 82,
    };
    const PRESET_QUIET_FLOOR = 35;

    function getCaptureMode() {
        const checked = document.querySelector('input[name="capture-mode"]:checked');
        return checked ? checked.value : 'display';
    }

    function formatHz(hz) {
        if (hz == null || !Number.isFinite(hz)) return t('notAvailable');
        if (hz >= 1000) {
            return (hz / 1000).toFixed(hz >= 10000 ? 1 : 2) + ' ' + t('khzUnit');
        }
        return Math.round(hz) + ' ' + t('hzUnit');
    }

    function applyStaticI18n() {
        document.querySelectorAll('[data-i18n]').forEach(function (el) {
            const key = el.getAttribute('data-i18n');
            el.textContent = t(key);
        });
        refreshPresetDeviceLabels();
        document.title = t('pageTitle');
        document.documentElement.lang = I18n.getLang();
    }

    function setStatus(text, isError) {
        statusMessage.textContent = text || '';
        statusMessage.classList.toggle('error', Boolean(isError));
    }

    function setBadge(state) {
        badgeState = state;
        const labels = {
            idle: t('badgeIdle'),
            silent: t('badgeSilent'),
            active: t('badgeActive'),
            waiting: t('badgeWaiting'),
        };
        activityBadge.className = 'badge badge-' + (state === 'waiting' ? 'silent' : state);
        activityBadge.textContent = labels[state] || labels.idle;
    }

    function rmsToDbfs(rms) {
        if (rms <= 1e-8) return -Infinity;
        return 20 * Math.log10(rms);
    }

    function isInputDeviceMode() {
        const mode = getCaptureMode();
        return mode === 'loopback' || mode === 'mic';
    }

    function isLoopbackDeviceLabel(label) {
        return LOOPBACK_LABEL_PATTERN.test(label || '');
    }

    function isCalibrated() {
        return splRefAtZeroDbfs != null && Number.isFinite(splRefAtZeroDbfs);
    }

    function dbfsToSpl(dbfs) {
        if (!isCalibrated() || !Number.isFinite(dbfs)) return null;
        return splRefAtZeroDbfs + dbfs;
    }

    function formatSplNumber(spl) {
        if (spl == null || !Number.isFinite(spl)) return '—';
        return spl.toFixed(1);
    }

    function getWhoVerdict(spl) {
        if (!isCalibrated() || spl == null || !Number.isFinite(spl)) {
            return { cls: 'who-neutral', key: 'whoUncalibrated' };
        }
        if (spl >= 100) return { cls: 'who-danger', key: 'whoOver100' };
        if (spl >= 85) return { cls: 'who-warn', key: 'whoOver85' };
        return { cls: 'who-ok', key: 'whoUnder85' };
    }

    function updateWhoVerdict(spl) {
        if (!whoVerdictEl || !whoVerdictText) return;
        const v = getWhoVerdict(spl);
        whoVerdictEl.className = 'who-verdict ' + v.cls;
        whoVerdictText.textContent = t(v.key);
    }

    function saveSplRef(ref) {
        splRefAtZeroDbfs = Math.min(130, Math.max(40, ref));
        localStorage.setItem('vision-audio-spl-ref', String(splRefAtZeroDbfs));
        localStorage.setItem('vision-audio-calibrated', '1');
    }

    function loadSplRef() {
        const stored = localStorage.getItem('vision-audio-spl-ref');
        if (stored != null && stored !== '') {
            const v = parseFloat(stored, 10);
            if (Number.isFinite(v)) splRefAtZeroDbfs = v;
        }
    }

    function getDbfsForCalibration() {
        if (Number.isFinite(lastRmsDb) && lastRmsDb > -55) return lastRmsDb;
        if (Number.isFinite(sessionMaxRmsDb) && sessionMaxRmsDb > -55) return sessionMaxRmsDb;
        if (Number.isFinite(lastPeakDb)) return lastPeakDb;
        if (Number.isFinite(sessionPeakDb)) return sessionPeakDb;
        return null;
    }

    function finishCalibration(knownSplDba, doneMessageKey) {
        const dbfs = getDbfsForCalibration();
        if (!Number.isFinite(dbfs) || dbfs <= -55) {
            setStatus(t('calNeedSignal'), true);
            return false;
        }
        saveSplRef(knownSplDba - dbfs);
        const nowSpl = dbfsToSpl(dbfs);
        const msg = t(doneMessageKey) + ' ' + formatSplNumber(nowSpl) + ' dBA';
        if (calStatus) calStatus.textContent = msg;
        setStatus(msg, false);
        if (lastPeakDb != null || lastRmsDb != null) {
            updateVolumeDisplays(lastPeakDb, lastRmsDb);
        }
        return true;
    }

    function ensureMonitoringForCal() {
        if (!mediaStream || !analyser) {
            setStatus(t('calNeedMonitor'), true);
            return false;
        }
        return true;
    }

    function applyMeterCalibration() {
        if (!ensureMonitoringForCal()) return;
        const meter = meterReadingInput ? parseFloat(meterReadingInput.value, 10) : NaN;
        if (!Number.isFinite(meter)) {
            setStatus(t('calNeedValue'), true);
            return;
        }
        finishCalibration(meter, 'calDone');
    }

    function applySubjectiveCalibration(anchorDba) {
        if (!ensureMonitoringForCal()) return;
        finishCalibration(anchorDba, 'calSubjectiveDone');
    }

    function estimatePresetSplDba(deviceKey, volumePercent) {
        const max = PRESET_MAX_DBA[deviceKey] || PRESET_MAX_DBA.overear;
        const pct = Math.min(100, Math.max(1, volumePercent)) / 100;
        return PRESET_QUIET_FLOOR + (max - PRESET_QUIET_FLOOR) * pct;
    }

    function applyPresetCalibration() {
        if (!ensureMonitoringForCal()) return;
        const deviceKey = presetDeviceSelect ? presetDeviceSelect.value : 'overear';
        const vol = presetVolumeInput ? parseInt(presetVolumeInput.value, 10) : 50;
        const estimated = estimatePresetSplDba(deviceKey, vol);
        finishCalibration(estimated, 'calPresetDone');
    }

    function refreshPresetDeviceLabels() {
        if (!presetDeviceSelect) return;
        const keys = {
            inear: 'presetInEar',
            overear: 'presetOverEar',
            speaker: 'presetSpeaker',
            laptop: 'presetLaptop',
        };
        presetDeviceSelect.querySelectorAll('option').forEach(function (opt) {
            const key = keys[opt.value];
            if (key) opt.textContent = t(key);
        });
    }

    function updateVolumeDisplays(currentPeakDb, rmsDb) {
        const rmsSpl = dbfsToSpl(rmsDb);
        const peakSpl = dbfsToSpl(currentPeakDb);
        const sessionSpl = dbfsToSpl(sessionMaxRmsDb);

        if (volumeNowDb) {
            volumeNowDb.textContent = isCalibrated() ? formatSplNumber(rmsSpl) : '—';
        }
        if (levelText) {
            if (!isCalibrated()) {
                levelText.textContent = t('calibrateFirst');
            } else if (peakSpl != null) {
                levelText.textContent = t('levelNowPeak') + ': ' + formatSplNumber(peakSpl) + ' ' + t('dbUnit');
            } else {
                levelText.textContent = t('levelNowPeak') + ': —';
            }
        }
        updatePeakDbDisplay(sessionSpl);
        updateWhoVerdict(rmsSpl);
    }

    function updatePeakDbDisplay(sessionSpl) {
        if (!peakDbText) return;
        if (!isCalibrated() || sessionSpl == null) {
            peakDbText.textContent = t('sessionPeak') + ': —';
        } else {
            peakDbText.textContent = t('sessionPeak') + ': ' + formatSplNumber(sessionSpl) + ' ' + t('dbUnit');
        }
    }

    function resetVolumeDisplays() {
        if (volumeNowDb) volumeNowDb.textContent = '—';
        if (levelText) {
            levelText.textContent = isCalibrated() ? t('levelNowPeak') + ': —' : t('calibrateFirst');
        }
        updatePeakDbDisplay(null);
        updateWhoVerdict(null);
    }

    function resetSessionPeak() {
        sessionPeakDb = -Infinity;
        sessionMaxRmsDb = -Infinity;
        resetVolumeDisplays();
    }

    function displaySurfaceLabel(surface) {
        const map = {
            browser: t('surfaceBrowser'),
            window: t('surfaceWindow'),
            monitor: t('surfaceMonitor'),
        };
        return map[surface] || surface || t('surfaceUnknown');
    }

    async function loadDefaultOutputLabel() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
            rateOutput.textContent = t('notAvailable');
            return;
        }
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const outputs = devices.filter(function (d) {
                return d.kind === 'audiooutput';
            });
            if (!outputs.length) {
                rateOutput.textContent = t('unknownValue');
                return;
            }
            const labeled = outputs.find(function (d) {
                return d.label;
            });
            rateOutput.textContent = (labeled || outputs[0]).label || t('unknownValue');
        } catch (_) {
            rateOutput.textContent = t('unknownValue');
        }
    }

    function readTrackSampleInfo(track) {
        const settings = track.getSettings ? track.getSettings() : {};
        let sampleRate = settings.sampleRate;
        let channelCount = settings.channelCount;

        if ((!sampleRate || !channelCount) && track.getCapabilities) {
            try {
                const caps = track.getCapabilities();
                if (!sampleRate && caps.sampleRate) {
                    if (typeof caps.sampleRate === 'object' && caps.sampleRate.max) {
                        sampleRate = caps.sampleRate.max;
                    }
                }
                if (!channelCount && caps.channelCount) {
                    if (typeof caps.channelCount === 'object' && caps.channelCount.max) {
                        channelCount = caps.channelCount.max;
                    }
                }
            } catch (_) {}
        }

        return { sampleRate: sampleRate, channelCount: channelCount };
    }

    function updateRatePanel(stream, context) {
        ratePanel.classList.remove('hidden');
        const audioTrack = stream.getAudioTracks()[0];
        const info = audioTrack ? readTrackSampleInfo(audioTrack) : {};

        rateCapture.textContent = info.sampleRate
            ? formatHz(info.sampleRate)
            : t('captureRateUnknown');

        const ctxRate = context ? context.sampleRate : null;
        rateContext.textContent = ctxRate ? formatHz(ctxRate) : t('notAvailable');
        rateChannels.textContent = info.channelCount != null ? String(info.channelCount) : t('unknownValue');

        if (ctxRate) {
            rateSpectrum.textContent = '0 – ' + formatHz(ctxRate / 2);
        } else {
            rateSpectrum.textContent = t('notAvailable');
        }

        loadDefaultOutputLabel();
    }

    function resetRatePanel() {
        ratePanel.classList.add('hidden');
        rateCapture.textContent = t('notAvailable');
        rateContext.textContent = t('notAvailable');
        rateChannels.textContent = t('notAvailable');
        rateSpectrum.textContent = t('notAvailable');
        ratePeak.textContent = t('notAvailable');
        rateOutput.textContent = t('notAvailable');
    }

    function updateSourcePanel(stream) {
        lastSourceStream = stream;
        const videoTracks = stream.getVideoTracks();
        const audioTracks = stream.getAudioTracks();

        sourcePanel.classList.remove('hidden');

        if (videoTracks.length) {
            const settings = videoTracks[0].getSettings();
            sourceType.textContent = displaySurfaceLabel(settings.displaySurface);
            sourceLabel.textContent = videoTracks[0].label || t('noLabel');
        } else if (audioTracks.length) {
            const mode = getCaptureMode();
            sourceType.textContent = mode === 'mic' ? t('sourceMic') : t('sourceLoopback');
            sourceLabel.textContent = audioTracks[0].label || loopbackSelect.selectedOptions[0]?.text || t('notAvailable');
        } else {
            sourceType.textContent = t('notAvailable');
            sourceLabel.textContent = t('notAvailable');
        }

        if (audioTracks.length) {
            sourceAudioTracks.textContent = audioTracks
                .map(function (track, i) {
                    return (i + 1) + '. ' + (track.label || 'audio') + (track.enabled ? '' : ' ' + t('trackDisabled'));
                })
                .join(' · ');
        } else {
            sourceAudioTracks.textContent = t('noAudioTracks');
        }
    }

    function refreshSourcePanelIfVisible() {
        if (lastSourceStream) updateSourcePanel(lastSourceStream);
    }

    function attachDisplayVideoKeepalive(stream) {
        if (!captureKeepalive || !stream.getVideoTracks().length) return;
        captureKeepalive.srcObject = stream;
        captureKeepalive.play().catch(function () {});
    }

    function clearDisplayVideoKeepalive() {
        if (!captureKeepalive) return;
        captureKeepalive.pause();
        captureKeepalive.srcObject = null;
    }

    async function requestDisplayStream() {
        const constraints = {
            video: {
                width: { ideal: 320 },
                height: { ideal: 180 },
                frameRate: { max: 5 },
            },
            audio: true,
        };

        if (typeof navigator.mediaDevices.getSupportedConstraints === 'function') {
            const supported = navigator.mediaDevices.getSupportedConstraints();
            if (supported.systemAudio) {
                constraints.audio = { systemAudio: 'include' };
            }
            if (supported.suppressLocalAudioPlayback) {
                constraints.suppressLocalAudioPlayback = true;
            }
        }

        return navigator.mediaDevices.getDisplayMedia(constraints);
    }

    function buildAudioConstraints(deviceId) {
        const audio = {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
        };
        if (deviceId && deviceId !== 'default') {
            audio.deviceId = { exact: deviceId };
        }
        return audio;
    }

    async function requestLoopbackStream() {
        const deviceId = loopbackSelect.value;
        if (!deviceId || deviceId === 'default') {
            throw new Error(t('errNoLoopback'));
        }
        return navigator.mediaDevices.getUserMedia({
            audio: buildAudioConstraints(deviceId),
            video: false,
        });
    }

    async function requestMicStream() {
        const deviceId = loopbackSelect.value;
        return navigator.mediaDevices.getUserMedia({
            audio: buildAudioConstraints(deviceId || 'default'),
            video: false,
        });
    }

    async function refreshInputDevices() {
        let permissionOk = false;
        try {
            const tmp = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            tmp.getTracks().forEach(function (track) {
                track.stop();
            });
            permissionOk = true;
        } catch (_) {
            setStatus(t('statusNeedMicPermission'), true);
        }

        const devices = await navigator.mediaDevices.enumerateDevices();
        const inputs = devices.filter(function (d) {
            return d.kind === 'audioinput';
        });

        const previous = loopbackSelect.value;
        const mode = getCaptureMode();
        loopbackSelect.innerHTML = '';

        if (mode === 'mic') {
            const defOpt = document.createElement('option');
            defOpt.value = 'default';
            defOpt.textContent = t('deviceDefaultMic');
            loopbackSelect.appendChild(defOpt);
        } else {
            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = t('loopbackPlaceholder');
            loopbackSelect.appendChild(placeholder);
        }

        if (!inputs.length) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = t('errNoInputs');
            loopbackSelect.appendChild(opt);
            return permissionOk;
        }

        const micGroup = document.createElement('optgroup');
        micGroup.label = t('deviceGroupMic');
        const loopGroup = document.createElement('optgroup');
        loopGroup.label = t('deviceGroupLoopback');

        inputs.forEach(function (device) {
            const opt = document.createElement('option');
            opt.value = device.deviceId;
            const label = device.label || t('audioInputFallback') + ' ' + device.deviceId.slice(0, 8);
            opt.textContent = label;
            if (isLoopbackDeviceLabel(device.label)) {
                loopGroup.appendChild(opt);
            } else {
                micGroup.appendChild(opt);
            }
        });

        if (micGroup.children.length) {
            loopbackSelect.appendChild(micGroup);
        }
        if (loopGroup.children.length) {
            loopbackSelect.appendChild(loopGroup);
        }

        const validValues = ['default', ''].concat(inputs.map(function (d) { return d.deviceId; }));
        if (previous && validValues.indexOf(previous) !== -1) {
            loopbackSelect.value = previous;
        } else if (mode === 'mic') {
            loopbackSelect.value = 'default';
        }

        return permissionOk;
    }

    function teardown() {
        if (animationId) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }
        clearDisplayVideoKeepalive();
        if (mediaStream) {
            mediaStream.getTracks().forEach(function (track) {
                track.stop();
            });
            mediaStream = null;
        }
        if (audioContext) {
            audioContext.close().catch(function () {});
            audioContext = null;
        }
        analyser = null;
        timeDomainBuffer = null;
        freqBuffer = null;
        lastSourceStream = null;
        lastRmsDb = null;
        lastPeakDb = null;

        meterFill.style.width = '0%';
        resetVolumeDisplays();
        setBadge('idle');
        startBtn.disabled = false;
        stopBtn.disabled = true;
        resetRatePanel();
    }

    function findPeakFrequency(byteFreqData, sampleRate) {
        const binCount = byteFreqData.length;
        const nyquist = sampleRate / 2;
        let maxIdx = 1;
        let maxVal = 0;
        for (let i = 1; i < binCount; i++) {
            if (byteFreqData[i] > maxVal) {
                maxVal = byteFreqData[i];
                maxIdx = i;
            }
        }
        if (maxVal < 8) return null;
        const hz = maxIdx * nyquist / binCount;
        return hz;
    }

    function drawFrame() {
        if (!analyser || !audioContext) return;

        analyser.getFloatTimeDomainData(timeDomainBuffer);
        analyser.getByteFrequencyData(freqBuffer);

        let sumSq = 0;
        let peakSample = 0;
        for (let i = 0; i < timeDomainBuffer.length; i++) {
            const s = timeDomainBuffer[i];
            sumSq += s * s;
            const abs = Math.abs(s);
            if (abs > peakSample) peakSample = abs;
        }
        const rms = Math.sqrt(sumSq / timeDomainBuffer.length);
        const db = rmsToDbfs(rms);
        const framePeakDb = rmsToDbfs(peakSample);
        if (Number.isFinite(framePeakDb) && framePeakDb > sessionPeakDb) {
            sessionPeakDb = framePeakDb;
        }
        if (Number.isFinite(db) && db > sessionMaxRmsDb) {
            sessionMaxRmsDb = db;
        }
        lastRmsDb = db;
        lastPeakDb = framePeakDb;
        updateVolumeDisplays(framePeakDb, db);
        const threshold = parseFloat(sensitivityInput.value, 10);

        meterFill.style.width = Math.min(100, rms * 400) + '%';

        if (rms >= threshold) {
            setBadge('active');
        } else if (badgeState === 'idle') {
            setBadge('idle');
        } else {
            setBadge('silent');
        }

        const peakHz = findPeakFrequency(freqBuffer, audioContext.sampleRate);
        ratePeak.textContent = peakHz != null ? formatHz(peakHz) : t('notAvailable');

        drawWaveform(timeDomainBuffer);
        drawSpectrum(freqBuffer);

        animationId = requestAnimationFrame(drawFrame);
    }

    function drawWaveform(buffer) {
        const ctx = waveformCanvas.getContext('2d');
        const w = waveformCanvas.width;
        const h = waveformCanvas.height;
        ctx.fillStyle = '#020617';
        ctx.fillRect(0, 0, w, h);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#2dd4bf';
        ctx.beginPath();
        const slice = w / buffer.length;
        for (let i = 0; i < buffer.length; i++) {
            const x = i * slice;
            const y = (0.5 + buffer[i] * 0.45) * h;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }

    function drawSpectrum(buffer) {
        const ctx = spectrumCanvas.getContext('2d');
        const w = spectrumCanvas.width;
        const h = spectrumCanvas.height;
        ctx.fillStyle = '#020617';
        ctx.fillRect(0, 0, w, h);
        const barWidth = w / buffer.length;
        for (let i = 0; i < buffer.length; i++) {
            const magnitude = buffer[i] / 255;
            const barHeight = magnitude * h;
            const hue = 160 + magnitude * 80;
            ctx.fillStyle = 'hsl(' + hue + ', 70%, 55%)';
            ctx.fillRect(i * barWidth, h - barHeight, Math.max(1, barWidth - 0.5), barHeight);
        }
    }

    async function startMonitoring() {
        setStatus('');
        teardown();
        resetSessionPeak();

        try {
            const mode = getCaptureMode();
            let stream;

            if (mode === 'display') {
                setStatus(t('statusPickShare'));
                stream = await requestDisplayStream();
                attachDisplayVideoKeepalive(stream);
            } else if (mode === 'mic') {
                stream = await requestMicStream();
            } else {
                stream = await requestLoopbackStream();
            }

            if (!stream.getAudioTracks().length) {
                stream.getTracks().forEach(function (track) {
                    track.stop();
                });
                throw new Error(t('errNoAudioTrack'));
            }

            mediaStream = stream;
            updateSourcePanel(stream);

            audioContext = new AudioContext();
            updateRatePanel(stream, audioContext);

            const source = audioContext.createMediaStreamSource(stream);
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 2048;
            analyser.smoothingTimeConstant = 0.75;
            source.connect(analyser);

            timeDomainBuffer = new Float32Array(analyser.fftSize);
            freqBuffer = new Uint8Array(analyser.frequencyBinCount);

            stream.getAudioTracks().forEach(function (track) {
                track.onended = function () {
                    setStatus(t('statusShareEnded'), false);
                    teardown();
                };
            });

            startBtn.disabled = true;
            stopBtn.disabled = false;
            setStatus(t('statusMonitoring'), false);
            setBadge('waiting');
            animationId = requestAnimationFrame(drawFrame);
        } catch (err) {
            teardown();
            const msg = err && err.message ? err.message : String(err);
            if (err && err.name === 'NotAllowedError') {
                setStatus(t('statusDenied'), true);
            } else {
                setStatus(msg, true);
            }
        }
    }

    function onLanguageChange() {
        applyStaticI18n();
        setBadge(badgeState);
        refreshSourcePanelIfVisible();
        if (mediaStream && audioContext) {
            updateRatePanel(mediaStream, audioContext);
        }
        if (isInputDeviceMode()) {
            refreshInputDevices().catch(function () {});
        }
        if (lastPeakDb != null) {
            updateVolumeDisplays(lastPeakDb, lastRmsDb);
        } else {
            resetVolumeDisplays();
        }
    }

    langToggle.addEventListener('click', function () {
        I18n.toggleLang();
        onLanguageChange();
    });

    modeRadios.forEach(function (radio) {
        radio.addEventListener('change', function () {
            loopbackWrap.classList.toggle('hidden', !isInputDeviceMode());
            if (isInputDeviceMode()) {
                refreshInputDevices().catch(function (e) {
                    setStatus(e.message || t('errListDevices'), true);
                });
            }
        });
    });

    sensitivityInput.addEventListener('input', function () {
        sensitivityValue.textContent = parseFloat(sensitivityInput.value, 10).toFixed(3);
    });

    refreshDevicesBtn.addEventListener('click', function () {
        refreshInputDevices().catch(function (e) {
            setStatus(e.message || t('errListDevices'), true);
        });
    });

    if (applyCalBtn) {
        applyCalBtn.addEventListener('click', applyMeterCalibration);
    }
    if (calAnchor85Btn) {
        calAnchor85Btn.addEventListener('click', function () {
            applySubjectiveCalibration(85);
        });
    }
    if (calAnchor100Btn) {
        calAnchor100Btn.addEventListener('click', function () {
            applySubjectiveCalibration(100);
        });
    }
    if (applyPresetCalBtn) {
        applyPresetCalBtn.addEventListener('click', applyPresetCalibration);
    }
    if (presetVolumeInput && presetVolumeValue) {
        presetVolumeInput.addEventListener('input', function () {
            presetVolumeValue.textContent = presetVolumeInput.value + '%';
        });
    }

    loadSplRef();

    startBtn.addEventListener('click', startMonitoring);
    stopBtn.addEventListener('click', function () {
        teardown();
        setStatus(t('statusStopped'), false);
        sourcePanel.classList.add('hidden');
    });

    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        navigator.mediaDevices.addEventListener('devicechange', function () {
            if (isInputDeviceMode()) {
                refreshInputDevices().catch(function () {});
            }
            if (ratePanel && !ratePanel.classList.contains('hidden')) {
                loadDefaultOutputLabel();
            }
        });
    }

    applyStaticI18n();
    setBadge('idle');
    resetVolumeDisplays();
})();
