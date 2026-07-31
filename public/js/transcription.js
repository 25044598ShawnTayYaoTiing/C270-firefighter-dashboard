document.addEventListener('DOMContentLoaded', () => {
  const transcriptTransfer = window.TranscriptTransfer;
  const startButton = document.getElementById('startTranscriptionButton');
  if (!startButton) return;

  const MAX_RECORDING_MS = 40000;
  const STOP_FLUSH_TIMEOUT_MS = 5000;
  const stopButton = document.getElementById('stopTranscriptionButton');
  const clearButton = document.getElementById('clearTranscriptButton');
  const cleanButton = document.getElementById('cleanTranscriptButton');
  const sendButton = document.getElementById('sendTranscriptButton');
  const sendCleanButton = document.getElementById('sendCleanTranscriptButton');
  const fullTranscriptDisplay = document.getElementById('fullTranscriptDisplay');
  const liveTranscriptDisplay = document.getElementById('liveTranscriptDisplay');
  const manualTranscriptInput = document.getElementById('manualTranscriptInput');
  const cleanedTranscriptInput = document.getElementById('cleanedTranscriptInput');
  const cleanupNotice = document.getElementById('cleanupNotice');
  const transcriptionState = document.getElementById('transcriptionState');
  const transcriptionNotice = document.getElementById('transcriptionNotice');
  const speechServiceStatus = document.getElementById('speechServiceStatus');
  const aiServiceStatus = document.getElementById('aiServiceStatus');
  const databaseStatus = document.getElementById('databaseStatus');

  let sampleRateHertz;
  let isCleaning = false;
  let fullTranscript = '';
  const liveTranscriptState = window.LiveTranscriptState.createLiveTranscriptState();
  const liveSession = window.LiveTranscriptionSession.createLiveTranscriptionSession({
    startSession: createBrowserSession,
    onResult: handleRecognitionResult,
    onComplete: completeLiveTranscription,
    onError: handleSessionError,
    onStateChange: updateTranscriptDisplays,
    maxRecordingMs: MAX_RECORDING_MS,
    stopTimeoutMs: STOP_FLUSH_TIMEOUT_MS
  });

  startButton.addEventListener('click', startTranscription);
  stopButton.addEventListener('click', stopTranscription);
  clearButton.addEventListener('click', clearTranscript);
  cleanButton.addEventListener('click', cleanTranscript);
  sendButton.addEventListener('click', sendTranscriptToCreateReport);
  sendCleanButton.addEventListener('click', sendCleanTranscriptToCreateReport);
  manualTranscriptInput.addEventListener('input', updateTranscriptDisplays);
  cleanedTranscriptInput.addEventListener('input', updateTranscriptDisplays);

  updateTranscriptDisplays();
  checkSystemStatus();

  async function checkSystemStatus() {
    try {
      const { data } = await fetchJson('/system/status', {}, 8000);
      setStatusBadge(speechServiceStatus, data.speechToText && data.speechToText.available);
      setStatusBadge(aiServiceStatus, data.ai && data.ai.available);
      setStatusBadge(databaseStatus, data.database && data.database.connected);
      setNotice(data.speechToText && data.speechToText.available ? 'ready' : 'warning',
        data.speechToText && data.speechToText.available
          ? 'Google Speech-to-Text is ready. Record a short call segment, then stop to transcribe it.'
          : data.speechToText && data.speechToText.error || 'Google Speech-to-Text is unavailable. You can still paste a transcript manually.');
    } catch (error) {
      setStatusBadge(speechServiceStatus, false);
      setStatusBadge(aiServiceStatus, false);
      setStatusBadge(databaseStatus, false);
      setNotice('warning', 'System status is unavailable. You can still paste a transcript manually.');
    }
  }

  async function startTranscription() {
    if (liveSession.isBusy()) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !(window.AudioContext || window.webkitAudioContext)) {
      setNotice('warning', 'This browser cannot record microphone audio. Manual transcript entry is available.');
      return;
    }

    liveTranscriptState.reset();
    cleanedTranscriptInput.value = '';
    hideCleanupNotice();
    updateTranscriptDisplays();
    setNotice('checking', 'Connecting to live transcription.');
    const started = await liveSession.start();
    if (started) setNotice('ready', 'Listening. Live transcript will appear as you speak.');
    updateTranscriptDisplays();
  }

  function createBrowserSession(handlers) {
    let mediaStream;
    let audioContext;
    let processor;
    let sourceNode;
    let silentGain;
    let socket;

    function releaseAudio() {
      if (processor) processor.disconnect();
      if (sourceNode) sourceNode.disconnect();
      if (silentGain) silentGain.disconnect();
      if (audioContext) {
        const closing = audioContext.close();
        if (closing && typeof closing.catch === 'function') closing.catch(() => {});
      }
      if (mediaStream) mediaStream.getTracks().forEach((track) => track.stop());
      processor = sourceNode = silentGain = audioContext = mediaStream = null;
    }

    function closeSocket() {
      if (!socket) return;
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
      socket = null;
    }

    return navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
    }).then(async (stream) => {
      mediaStream = stream;
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      sampleRateHertz = audioContext.sampleRate;
      const { data } = await fetchJson('/api/transcribe/stream-token', { method: 'POST' }, 8000);
      if (!data || !data.token) throw new Error('Live transcription is unavailable.');

      socket = await connectLiveSocket(data.token, sampleRateHertz, handlers);
      sourceNode = audioContext.createMediaStreamSource(mediaStream);
      processor = audioContext.createScriptProcessor(4096, 1, 1);
      silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      processor.onaudioprocess = (event) => {
        liveSession.sendAudio(floatToPcm16(event.inputBuffer.getChannelData(0)));
      };
      sourceNode.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(audioContext.destination);

      return {
        sendAudio(audio) {
          if (socket && socket.readyState === WebSocket.OPEN) socket.send(audio);
        },
        sendStop() {
          if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'stop' }));
          else handlers.onClose();
        },
        cleanupAudio: releaseAudio,
        close: closeSocket
      };
    }).catch((error) => {
      releaseAudio();
      closeSocket();
      throw error;
    });
  }

  function stopTranscription() {
    if (!liveSession.isRecording()) return;
    setNotice('checking', 'Finishing the live transcription.');
    liveSession.stop();
    updateTranscriptDisplays();
  }

  function connectLiveSocket(token, sampleRate, handlers) {
    return new Promise((resolve, reject) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${protocol}//${window.location.host}/api/transcribe/stream?token=${encodeURIComponent(token)}`);
      let ready = false;
      let settled = false;
      let terminalNotified = false;
      const timeout = window.setTimeout(() => {
        if (!ready) failBeforeReady(new Error('Live transcription connection timed out.'));
      }, 8000);

      function failBeforeReady(error) {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
        reject(error);
      }

      function notifyError(error) {
        if (terminalNotified) return;
        terminalNotified = true;
        handlers.onError(error);
      }

      function notifyClose() {
        if (terminalNotified) return;
        terminalNotified = true;
        handlers.onClose();
      }

      socket.addEventListener('open', () => {
        socket.send(JSON.stringify({ type: 'start', sampleRateHertz: sampleRate }));
      });
      socket.addEventListener('message', (event) => {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch (error) {
          return;
        }

        if (message.type === 'ready') {
          ready = true;
          settled = true;
          window.clearTimeout(timeout);
          resolve(socket);
          return;
        }
        if (!ready) return;
        if (message.type === 'transcript') handlers.onResult(message);
        if (message.type === 'error') notifyError(new Error(message.message || 'Live transcription failed.'));
        if (message.type === 'ended') {
          terminalNotified = true;
          handlers.onEnded();
        }
      });
      socket.addEventListener('close', () => {
        window.clearTimeout(timeout);
        if (!ready) {
          failBeforeReady(new Error('Live transcription connection closed before it was ready.'));
          return;
        }
        notifyClose();
      });
      socket.addEventListener('error', () => {
        if (!ready) failBeforeReady(new Error('Live transcription connection failed.'));
        else notifyError(new Error('Live transcription connection failed.'));
      });
    });
  }

  function handleRecognitionResult(message) {
    liveTranscriptState.applyResult({
      transcript: message.transcript,
      isFinal: message.isFinal === true
    });
    updateTranscriptDisplays();
  }

  function completeLiveTranscription(reason, error) {
    const completed = liveTranscriptState.finalize().finalTranscript;
    if (completed) appendToFullTranscript(completed);
    liveTranscriptState.reset();

    if (reason === 'ended' || reason === 'stopped') {
      setNotice(completed ? 'ready' : 'warning', completed ? 'Transcript is ready for review.' : 'No speech was detected. Try again or enter text manually.');
    } else if (reason === 'timeout') {
      setNotice(completed ? 'warning' : 'warning', completed
        ? 'Transcription took too long to finish. Captured text was preserved.'
        : 'Transcription timed out. Try again or enter text manually.');
    } else if (reason === 'cancelled') {
      setNotice('warning', 'Transcription was cleared before it finished.');
    } else if (!error) {
      setNotice('warning', completed
        ? 'Live transcription ended unexpectedly. Captured text was preserved.'
        : 'Live transcription failed. Try again or enter text manually.');
    }
    updateTranscriptDisplays();
  }

  function handleSessionError(error) {
    const name = error && error.name;
    const message = name === 'NotAllowedError' || name === 'PermissionDeniedError'
      ? 'Microphone permission was denied. You can enter a transcript manually.'
      : name === 'NotFoundError' || name === 'NotReadableError'
        ? 'No usable microphone is available. You can enter a transcript manually.'
        : error && error.message || 'Live transcription is unavailable. You can enter a transcript manually.';
    setNotice('warning', message);
    updateTranscriptDisplays();
  }

  function clearTranscript() {
    if (liveSession.isBusy()) liveSession.cancel();
    fullTranscript = '';
    liveTranscriptState.reset();
    manualTranscriptInput.value = '';
    cleanedTranscriptInput.value = '';
    const storage = getLocalStorage();
    if (transcriptTransfer && storage) transcriptTransfer.clear(storage);
    hideCleanupNotice();
    updateTranscriptDisplays();
  }

  async function cleanTranscript() {
    const transcript = getRawTranscript();
    if (!transcript.trim() || isCleaning) return showCleanupNotice('warning', 'Add transcript text before cleaning.');
    isCleaning = true;
    setButtonBusy(cleanButton, true, 'Cleaning...');
    try {
      const { data } = await fetchJson('/api/ai/clean-transcript', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcript })
      }, 70000);
      cleanedTranscriptInput.value = data.cleanedTranscript || transcript;
      showCleanupNotice(data.success ? 'ready' : 'warning', data.success ? 'Cleaned transcript is ready for review.' : data.error || 'Cleanup failed.');
    } catch (error) {
      cleanedTranscriptInput.value = transcript;
      showCleanupNotice('warning', error.message || 'Cleanup request failed.');
    } finally {
      isCleaning = false;
      setButtonBusy(cleanButton, false, 'Clean Transcript');
      updateTranscriptDisplays();
    }
  }

  function sendTranscriptToCreateReport() {
    sendToCreateReport(getRawTranscript(), transcriptTransfer && transcriptTransfer.SOURCES.RAW, setNotice);
  }

  function sendCleanTranscriptToCreateReport() {
    sendToCreateReport(getCleanTranscript(), transcriptTransfer && transcriptTransfer.SOURCES.CLEAN, showCleanupNotice);
  }

  function sendToCreateReport(transcript, source, notify) {
    if (!transcript.trim()) return notify('warning', 'Add transcript text before sending it to Create Report.');
    if (!transcriptTransfer || !source) return notify('warning', 'Transcript transfer is unavailable. Please try again.');

    const storage = getLocalStorage();
    const result = storage
      ? transcriptTransfer.save(storage, source, transcript)
      : { ok: false, reason: 'storage' };
    if (!result.ok) {
      notify('warning', result.reason === 'empty'
        ? 'Add transcript text before sending it to Create Report.'
        : 'The transcript could not be transferred. Please try again.');
      return;
    }
    window.location.href = '/create-report?transcript=sent';
  }

  function getRawTranscript() {
    const completed = normalizeTranscriptText(fullTranscript);
    return completed.trim() ? completed : normalizeTranscriptText(manualTranscriptInput.value);
  }

  function getCleanTranscript() {
    return normalizeTranscriptText(cleanedTranscriptInput.value);
  }

  function appendToFullTranscript(text) {
    fullTranscript = [fullTranscript, text].filter(Boolean).join('\n');
  }

  function normalizeTranscriptText(text) {
    return transcriptTransfer
      ? transcriptTransfer.normalizeTranscript(text)
      : String(text || '');
  }

  function getLocalStorage() {
    try {
      return window.localStorage;
    } catch (error) {
      return null;
    }
  }

  function updateTranscriptDisplays() {
    const liveTranscript = liveTranscriptState.snapshot().displayedTranscript;
    renderTranscriptText(fullTranscriptDisplay, fullTranscript, 'No completed transcript yet.');
    renderTranscriptText(liveTranscriptDisplay, liveTranscript, 'Waiting for a recording...');
    const hasRaw = Boolean(getRawTranscript().trim());
    const hasClean = Boolean(getCleanTranscript().trim());
    startButton.disabled = liveSession.isBusy();
    stopButton.disabled = !liveSession.isRecording();
    cleanButton.disabled = isCleaning || !hasRaw;
    sendButton.disabled = !hasRaw;
    sendCleanButton.disabled = !hasClean;
  }

  function renderTranscriptText(element, text, emptyMessage) {
    element.textContent = normalizeTranscriptText(text);
    if (!element.textContent.trim()) element.innerHTML = `<p class="empty-transcript">${emptyMessage}</p>`;
  }

  function setNotice(state, message) {
    transcriptionState.textContent = state === 'ready' ? 'Ready' : state === 'warning' ? 'Warning' : 'Working';
    transcriptionState.className = state === 'ready' ? 'status-badge status-completed' : state === 'warning' ? 'status-badge status-escalated' : 'status-badge status-draft';
    transcriptionNotice.className = state === 'warning' ? 'notice-strip notice-warning' : 'notice-strip';
    transcriptionNotice.querySelector('span').textContent = message;
  }

  function setStatusBadge(element, available) { element.classList.toggle('is-up', Boolean(available)); element.classList.toggle('is-down', !available); }
  function showCleanupNotice(state, message) { cleanupNotice.className = state === 'warning' ? 'notice-strip notice-warning' : 'notice-strip'; cleanupNotice.querySelector('span').textContent = message; }
  function hideCleanupNotice() { cleanupNotice.className = 'notice-strip notice-hidden'; cleanupNotice.querySelector('span').textContent = ''; }
  function setButtonBusy(button, busy, label) { button.setAttribute('aria-busy', String(busy)); button.lastChild.textContent = `\n        ${busy ? label : button.dataset.idleLabel || label}\n      `; if (!button.dataset.idleLabel) button.dataset.idleLabel = 'Clean Transcript'; }

  async function fetchJson(url, options, timeoutMs) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(window.apiUrl(url), { ...options, credentials: 'include', signal: controller.signal });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data && data.error || `Request failed (${response.status}).`);
      return { data };
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('The request timed out. Please try again.');
      throw error;
    } finally { window.clearTimeout(timeout); }
  }
});

function floatToPcm16(samples) {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  samples.forEach((sample, index) => view.setInt16(index * 2, Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 0x8000 : 0x7fff), true));
  return buffer;
}
