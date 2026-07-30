document.addEventListener('DOMContentLoaded', () => {
  const TRANSCRIPT_STORAGE_KEY = 'firefighter.transcriptDraft';
  const MAX_RECORDING_MS = 40000;
  const startButton = document.getElementById('startTranscriptionButton');
  if (!startButton) return;

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

  let mediaStream;
  let audioContext;
  let processor;
  let sourceNode;
  let silentGain;
  let sampleRateHertz;
  let liveSocket;
  let liveFinalSegments = [];
  let currentInterim = '';
  let isRecording = false;
  let isStopping = false;
  let isCleaning = false;
  let liveTranscript = '';
  let fullTranscript = '';

  startButton.addEventListener('click', startTranscription);
  stopButton.addEventListener('click', () => stopTranscription());
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
    if (isRecording || isStopping) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.AudioContext) {
      setNotice('warning', 'This browser cannot record microphone audio. Manual transcript entry is available.');
      return;
    }

    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
      });
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      sampleRateHertz = audioContext.sampleRate;
      const { data } = await fetchJson('/api/transcribe/stream-token', { method: 'POST' }, 8000);
      liveSocket = await connectLiveSocket(data.token, sampleRateHertz);
      sourceNode = audioContext.createMediaStreamSource(mediaStream);
      processor = audioContext.createScriptProcessor(4096, 1, 1);
      silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      processor.onaudioprocess = (event) => {
        if (isRecording && liveSocket && liveSocket.readyState === WebSocket.OPEN) {
          liveSocket.send(floatToPcm16(event.inputBuffer.getChannelData(0)));
        }
      };
      sourceNode.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(audioContext.destination);
      isRecording = true;
      liveFinalSegments = [];
      currentInterim = '';
      setNotice('ready', 'Listening. Live transcript will appear as you speak.');
    } catch (error) {
      releaseAudio();
      setNotice('warning', 'Microphone access was unavailable. Check browser permission and try again.');
    } finally {
      updateTranscriptDisplays();
    }
  }

  async function stopTranscription() {
    if (!isRecording || isStopping) return;
    isRecording = false;
    isStopping = true;
    releaseAudio();
    updateTranscriptDisplays();
    setNotice('checking', 'Finishing the live transcription.');
    if (liveSocket && liveSocket.readyState === WebSocket.OPEN) liveSocket.send(JSON.stringify({ type: 'stop' }));
    else finishLiveTranscription();
  }

  function connectLiveSocket(token, sampleRate) {
    return new Promise((resolve, reject) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${protocol}//${window.location.host}/api/transcribe/stream?token=${encodeURIComponent(token)}`);
      const timeout = window.setTimeout(() => { socket.close(); reject(new Error('Live transcription connection timed out.')); }, 8000);
      socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'start', sampleRateHertz: sampleRate })));
      socket.addEventListener('message', (event) => {
        let message; try { message = JSON.parse(event.data); } catch { return; }
        if (message.type === 'ready') { window.clearTimeout(timeout); resolve(socket); }
        if (message.type === 'transcript') handleRecognitionResult(message);
        if (message.type === 'error') { setNotice('warning', message.message || 'Live transcription failed.'); if (isStopping) finishLiveTranscription(); }
        if (message.type === 'ended') finishLiveTranscription();
      });
      socket.addEventListener('close', () => { if (isRecording) { isRecording = false; releaseAudio(); setNotice('warning', 'Live transcription connection closed. Finalized text was preserved.'); } });
      socket.addEventListener('error', () => reject(new Error('Live transcription connection failed.')));
    });
  }

  function handleRecognitionResult(message) {
    const text = normalizeTranscriptText(message.transcript);
    if (!text) return;
    if (message.isFinal) {
      if (liveFinalSegments[liveFinalSegments.length - 1] !== text) liveFinalSegments.push(text);
      currentInterim = '';
    } else currentInterim = text;
    liveTranscript = [...liveFinalSegments, currentInterim].filter(Boolean).join(' ');
    updateTranscriptDisplays();
  }

  function finishLiveTranscription() {
    if (!isStopping && !isRecording) return;
    const completed = liveFinalSegments.join(' ');
    if (completed) appendToFullTranscript(completed);
    liveTranscript = '';
    currentInterim = '';
    isStopping = false;
    if (liveSocket) liveSocket.close();
    liveSocket = null;
    setNotice(completed ? 'ready' : 'warning', completed ? 'Transcript is ready for review.' : 'No speech was detected. Try again or enter text manually.');
    updateTranscriptDisplays();
  }

  function releaseAudio() {
    if (processor) processor.disconnect();
    if (sourceNode) sourceNode.disconnect();
    if (silentGain) silentGain.disconnect();
    if (audioContext) audioContext.close();
    if (mediaStream) mediaStream.getTracks().forEach((track) => track.stop());
    processor = sourceNode = silentGain = audioContext = mediaStream = null;
  }

  function clearTranscript() {
    fullTranscript = '';
    liveTranscript = '';
    manualTranscriptInput.value = '';
    cleanedTranscriptInput.value = '';
    hideCleanupNotice();
    updateTranscriptDisplays();
  }

  async function cleanTranscript() {
    const transcript = getRawTranscript();
    if (!transcript || isCleaning) return showCleanupNotice('warning', 'Add transcript text before cleaning.');
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

  function sendTranscriptToCreateReport() { sendToCreateReport(getRawTranscript(), setNotice); }
  function sendCleanTranscriptToCreateReport() { sendToCreateReport(getCleanTranscript(), showCleanupNotice); }
  function sendToCreateReport(transcript, notify) {
    if (!transcript) return notify('warning', 'Add transcript text before sending it to Create Report.');
    localStorage.setItem(TRANSCRIPT_STORAGE_KEY, transcript);
    window.location.href = '/create-report?transcript=sent';
  }

  function getRawTranscript() { return normalizeTranscriptText(fullTranscript) || normalizeTranscriptText(manualTranscriptInput.value); }
  function getCleanTranscript() { return normalizeTranscriptText(cleanedTranscriptInput.value) || getRawTranscript(); }
  function appendToFullTranscript(text) { fullTranscript = [fullTranscript, text].filter(Boolean).join('\n'); }
  function normalizeTranscriptText(text) { return String(text || '').replace(/\s+/g, ' ').trim(); }

  function updateTranscriptDisplays() {
    renderTranscriptText(fullTranscriptDisplay, fullTranscript, 'No completed transcript yet.');
    renderTranscriptText(liveTranscriptDisplay, liveTranscript, 'Waiting for a recording...');
    const hasRaw = Boolean(getRawTranscript());
    startButton.disabled = isRecording || isStopping;
    stopButton.disabled = !isRecording;
    cleanButton.disabled = isCleaning || !hasRaw;
    sendButton.disabled = !hasRaw;
    sendCleanButton.disabled = !getCleanTranscript();
  }

  function renderTranscriptText(element, text, emptyMessage) {
    element.textContent = normalizeTranscriptText(text);
    if (!element.textContent) element.innerHTML = `<p class="empty-transcript">${emptyMessage}</p>`;
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

function joinAudioChunks(chunks) {
  const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const joined = new Uint8Array(length);
  let offset = 0;
  chunks.forEach((chunk) => { joined.set(new Uint8Array(chunk), offset); offset += chunk.byteLength; });
  return joined.buffer;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}
