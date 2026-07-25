document.addEventListener('DOMContentLoaded', () => {
  const TRANSCRIPT_STORAGE_KEY = 'firefighter.transcriptDraft';
  const transcriptionLayout = document.querySelector('.transcription-layout');
  const configuredServiceWsUrl = transcriptionLayout
    ? transcriptionLayout.dataset.realtimeSttWsUrl.trim()
    : '';
  const serviceWsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const serviceWsUrl = configuredServiceWsUrl
    || `${serviceWsProtocol}//${window.location.hostname}:8010/ws/transcribe`;

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
  const realtimeServiceStatus = document.getElementById('realtimeServiceStatus');
  const aiServiceStatus = document.getElementById('aiServiceStatus');
  const databaseStatus = document.getElementById('databaseStatus');

  let socket = null;
  let mediaStream = null;
  let audioContext = null;
  let processor = null;
  let sourceNode = null;
  let silentGain = null;
  let isStreaming = false;
  let isConnecting = false;
  let isCleaning = false;
  let liveTranscript = '';
  let fullTranscript = '';
  let lastCommittedTranscript = '';

  // Done by: Khin (25036933)
  // Set up the main UI controls and initialize the transcript views.
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

  // Done by: Khin (25036933)
  // Check whether the live transcription and AI services are available before the user starts streaming.
  async function checkSystemStatus() {
    try {
      const response = await fetch(window.apiUrl('/system/status'), { cache: 'no-store', credentials: 'include' });
      const status = await response.json();

      setStatusBadge(realtimeServiceStatus, status.realtimeStt && status.realtimeStt.available, 'Online', 'Offline');
      setStatusBadge(aiServiceStatus, status.ai && status.ai.available, 'Online', 'Offline');
      setStatusBadge(databaseStatus, status.database && status.database.connected, 'Connected', 'Error');

      if (status.realtimeStt && status.realtimeStt.available) {
        setNotice('ready', 'Call transcription service is online.');
      } else {
        setNotice('warning', 'Call transcription service is currently unavailable. You can still paste a transcript manually.');
      }
    } catch (error) {
      setStatusBadge(realtimeServiceStatus, false, 'Online', 'Offline');
      setStatusBadge(aiServiceStatus, false, 'Online', 'Offline');
      setStatusBadge(databaseStatus, false, 'Connected', 'Error');
      setNotice('warning', 'Call transcription service is currently unavailable. You can still paste a transcript manually.');
    }
  }

  // Done by: Khin (25036933)
  // Start microphone capture and connect to the live transcription service.
  async function startTranscription() {
    if (isStreaming || isConnecting) return;

    if (!window.WebSocket || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setNotice('warning', 'This browser cannot stream microphone audio. Manual transcript entry is available.');
      return;
    }

    try {
      isConnecting = true;
      updateTranscriptDisplays();
      setNotice('checking', 'Connecting to call transcription service.');
      socket = await connectSocket();
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true
        }
      });

      startAudioStreaming();
      socket.send(JSON.stringify({ type: 'start' }));
      isStreaming = true;
      setNotice('ready', 'Transcription stream is active.');
    } catch (error) {
      stopTranscription({ commitLive: false });
      setNotice('warning', 'Call transcription service is currently unavailable. You can still paste a transcript manually.');
    } finally {
      isConnecting = false;
      updateTranscriptDisplays();
    }
  }

  // Done by: Khin (25036933)
  // Open a websocket connection so the browser can receive transcription updates in real time.
  function connectSocket() {
    return new Promise((resolve, reject) => {
      const nextSocket = new WebSocket(serviceWsUrl);
      const timeout = window.setTimeout(() => {
        nextSocket.close();
        reject(new Error('Call transcription connection timed out.'));
      }, 4000);

      nextSocket.binaryType = 'arraybuffer';

      nextSocket.addEventListener('open', () => {
        window.clearTimeout(timeout);
        resolve(nextSocket);
      });

      nextSocket.addEventListener('message', handleSocketMessage);
      nextSocket.addEventListener('close', () => {
        if (isStreaming || isConnecting) {
          stopTranscription();
          setNotice('warning', 'Call transcription service is currently unavailable. You can still paste a transcript manually.');
        }
      });

      nextSocket.addEventListener('error', () => {
        window.clearTimeout(timeout);
        reject(new Error('Call transcription service is currently unavailable.'));
      });
    });
  }

  function startAudioStreaming() {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    sourceNode = audioContext.createMediaStreamSource(mediaStream);
    processor = audioContext.createScriptProcessor(4096, 1, 1);
    silentGain = audioContext.createGain();
    silentGain.gain.value = 0;

    processor.onaudioprocess = (event) => {
      if (!socket || socket.readyState !== WebSocket.OPEN || !isStreaming) return;

      const samples = event.inputBuffer.getChannelData(0);
      socket.send(buildAudioPacket(samples, audioContext.sampleRate));
    };

    sourceNode.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(audioContext.destination);
  }

  function stopTranscription(options = {}) {
    const shouldCommitLive = options.commitLive !== false;

    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'stop' }));
    }

    if (shouldCommitLive) {
      commitLiveTranscript();
    }

    isStreaming = false;
    isConnecting = false;

    if (processor) processor.disconnect();
    if (sourceNode) sourceNode.disconnect();
    if (silentGain) silentGain.disconnect();
    if (audioContext) audioContext.close();
    if (mediaStream) mediaStream.getTracks().forEach((track) => track.stop());
    if (socket) socket.close();

    processor = null;
    sourceNode = null;
    silentGain = null;
    audioContext = null;
    mediaStream = null;
    socket = null;
    updateTranscriptDisplays();
  }

  // Done by: Khin (25036933)
  // Process incoming transcription messages and decide whether they should appear as live text or finalized text.
  function handleSocketMessage(event) {
    let message;

    try {
      message = JSON.parse(event.data);
    } catch (error) {
      return;
    }

    if (message.type === 'ready' || message.type === 'hello') {
      setNotice('ready', 'Call transcription service is online.');
      return;
    }

    if (message.type === 'warning') {
      setNotice('warning', message.message || 'Call transcription service reported a warning.');
      return;
    }

    if (message.type === 'error') {
      setNotice('warning', message.message || 'Call transcription service reported an error.');
      return;
    }

    if (message.type === 'clear') {
      liveTranscript = '';
      updateTranscriptDisplays();
      return;
    }

    const text = normalizeTranscriptText(extractTranscriptText(message));
    if (!text) return;

    if (isFinalTranscriptMessage(message)) {
      appendToFullTranscript(text);
      liveTranscript = '';
      updateTranscriptDisplays();
      return;
    }

    if (isLiveTranscriptMessage(message) || text) {
      updateLiveTranscript(text);
    }
  }

  function extractTranscriptText(message) {
    return message.text || message.transcript || (message.segment && message.segment.text) || '';
  }

  function isFinalTranscriptMessage(message) {
    return message.type === 'final'
      || message.type === 'final_transcript'
      || message.isFinal === true
      || message.is_final === true
      || (message.segment && message.segment.is_final === true);
  }

  function isLiveTranscriptMessage(message) {
    return message.type === 'realtime'
      || message.type === 'partial'
      || message.type === 'live'
      || message.type === 'transcript';
  }

  function updateLiveTranscript(text) {
    const nextTranscript = normalizeTranscriptText(text);
    if (!nextTranscript) return;

    liveTranscript = nextTranscript;
    updateTranscriptDisplays();
  }

  // Done by: Khin (25036933)
  // Keep the completed transcript readable by avoiding duplicate or repeated segments.
  function appendToFullTranscript(text) {
    const normalizedSegment = normalizeTranscriptText(text);
    const existingSegments = getFullTranscriptSegments();
    const lastSegment = existingSegments[existingSegments.length - 1] || '';

    if (isDuplicateOrPrefix(normalizedSegment, lastSegment || lastCommittedTranscript)) return false;

    if (shouldReplaceLastSegment(normalizedSegment, lastSegment)) {
      existingSegments[existingSegments.length - 1] = normalizedSegment;
      setFullTranscriptSegments(existingSegments);
      lastCommittedTranscript = normalizedSegment;
      return true;
    }

    existingSegments.push(normalizedSegment);
    setFullTranscriptSegments(existingSegments);
    lastCommittedTranscript = normalizedSegment;
    return true;
  }

  function isDuplicateOrPrefix(newText, oldText) {
    const normalizedNewText = normalizeTranscriptText(newText);
    const normalizedOldText = normalizeTranscriptText(oldText);
    const fullText = normalizeTranscriptText(fullTranscript);

    if (!normalizedNewText) return true;
    if (normalizedOldText && normalizedNewText === normalizedOldText) return true;
    if (fullText && transcriptEndsWith(fullText, normalizedNewText)) return true;

    return Boolean(
      normalizedOldText
      && normalizedOldText.toLowerCase().startsWith(normalizedNewText.toLowerCase())
    );
  }

  function shouldReplaceLastSegment(newText, lastSegment) {
    const normalizedNewText = normalizeTranscriptText(newText);
    const normalizedLastSegment = normalizeTranscriptText(lastSegment);

    return Boolean(
      normalizedLastSegment
      && normalizedNewText.length > normalizedLastSegment.length
      && (
        normalizedNewText.toLowerCase().startsWith(normalizedLastSegment.toLowerCase())
        || isLikelyRevisionOfLastSegment(normalizedNewText, normalizedLastSegment)
      )
    );
  }

  function isLikelyRevisionOfLastSegment(newText, lastSegment) {
    const newWords = getTranscriptWords(newText);
    const lastWords = getTranscriptWords(lastSegment);

    if (newWords.length < 4 || lastWords.length < 4 || newWords[0] !== lastWords[0]) return false;

    const newWordSet = new Set(newWords);
    const sharedWords = lastWords.filter((word) => newWordSet.has(word)).length;
    const sharedRatio = sharedWords / lastWords.length;

    return sharedRatio >= 0.6;
  }

  function getTranscriptWords(text) {
    return normalizeTranscriptText(text)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  }

  function transcriptEndsWith(fullText, text) {
    return normalizeTranscriptText(fullText).toLowerCase().endsWith(normalizeTranscriptText(text).toLowerCase());
  }

  function getFullTranscriptSegments() {
    return fullTranscript
      .split('\n')
      .map((segment) => normalizeTranscriptText(segment))
      .filter(Boolean);
  }

  function setFullTranscriptSegments(segments) {
    fullTranscript = segments
      .map((segment) => normalizeTranscriptText(segment))
      .filter(Boolean)
      .join('\n');
  }

  // Done by: Khin (25036933)
  // Move any live transcript text into the main transcript when the user wants to save or send it.
  function commitLiveTranscript(options = {}) {
    const shouldClearLive = options.clearLive !== false;
    const normalizedLiveTranscript = normalizeTranscriptText(liveTranscript);

    if (normalizedLiveTranscript) {
      appendToFullTranscript(normalizedLiveTranscript);
    }

    if (shouldClearLive) {
      liveTranscript = '';
    }

    updateTranscriptDisplays();
    return normalizeTranscriptText(fullTranscript);
  }

  function updateTranscriptDisplays() {
    renderTranscriptText(fullTranscriptDisplay, fullTranscript, 'No completed transcript yet.');
    renderTranscriptText(liveTranscriptDisplay, liveTranscript, 'Waiting for speech input...');

    const hasRawTranscript = hasTranscriptForRawActions();
    const hasCleanTranscript = hasTranscriptForCleanSend();

    startButton.disabled = isConnecting || isStreaming;
    stopButton.disabled = !isConnecting && !isStreaming;
    cleanButton.disabled = isCleaning || !hasRawTranscript;
    sendButton.disabled = !hasRawTranscript;
    sendCleanButton.disabled = !hasCleanTranscript;
  }

  function clearTranscript(sendCommand = true) {
    liveTranscript = '';
    fullTranscript = '';
    lastCommittedTranscript = '';
    manualTranscriptInput.value = '';
    cleanedTranscriptInput.value = '';
    hideCleanupNotice();
    updateTranscriptDisplays();

    if (sendCommand && socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'clear' }));
    }
  }

  // Done by: Khin (25036933)
  // Normalize whitespace so transcript text is displayed and stored consistently.
  function normalizeTranscriptText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function renderTranscriptText(element, text, emptyMessage) {
    if (!element) return;

    element.textContent = '';

    if (!normalizeTranscriptText(text)) {
      const emptyState = document.createElement('p');
      emptyState.className = 'empty-transcript';
      emptyState.textContent = emptyMessage;
      element.appendChild(emptyState);
      return;
    }

    element.textContent = text;
  }

  // Done BY SHAWN ID 25044598
  // AI Features: sends raw transcript text to the AI cleanup endpoint and displays reviewed output.
  async function cleanTranscript() {
    if (isCleaning) return;

    const transcript = getTranscriptForCleaning();

    if (!transcript) {
      showCleanupNotice('warning', 'Add transcript text before cleaning.');
      return;
    }

    isCleaning = true;
    updateTranscriptDisplays();
    setButtonBusy(cleanButton, true, 'Cleaning...');
    showCleanupNotice('checking', 'Cleaning transcript for review.');

    try {
      const { data } = await fetchAiJson('/api/ai/clean-transcript', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ transcript })
      });

      cleanedTranscriptInput.value = data.cleanedTranscript || transcript;

      if (data.success) {
        showCleanupNotice('ready', 'Cleaned transcript is ready for review.');
      } else {
        showCleanupNotice('warning', data.error || 'Cleanup failed. You can edit the transcript manually.');
      }
    } catch (error) {
      cleanedTranscriptInput.value = transcript;
      showCleanupNotice('warning', error.message || 'Cleanup request failed. You can edit the transcript manually.');
    } finally {
      isCleaning = false;
      updateTranscriptDisplays();
      setButtonBusy(cleanButton, false, 'Clean Transcript');
    }
  }

  function sendTranscriptToCreateReport() {
    const transcriptData = getTranscriptForSending();

    if (!transcriptData.text) {
      setNotice('warning', 'Add transcript text before sending it to Create Report.');
      return;
    }

    localStorage.setItem(TRANSCRIPT_STORAGE_KEY, transcriptData.text);
    window.location.href = '/create-report?transcript=sent';
  }

  // Done BY SHAWN ID 25044598
  // AI Features: moves cleaned transcript text into Create Report for AI-assisted draft generation.
  function sendCleanTranscriptToCreateReport() {
    const transcriptData = getCleanTranscriptForSending();

    if (!transcriptData.text) {
      showCleanupNotice('warning', 'Add transcript text before sending it to Create Report.');
      return;
    }

    localStorage.setItem(TRANSCRIPT_STORAGE_KEY, transcriptData.text);
    window.location.href = '/create-report?transcript=sent';
  }

  function getTranscriptForSending() {
    commitLiveTranscript();

    const full = normalizeTranscriptText(fullTranscript);
    const live = normalizeTranscriptText(liveTranscript);
    const manual = normalizeTranscriptText(manualTranscriptInput.value);

    if (full) return { text: full, source: 'fullTranscript' };
    if (live) return { text: live, source: 'liveTranscript' };
    if (manual) return { text: manual, source: 'manualTranscriptInput' };

    return { text: '', source: '' };
  }

  function getTranscriptForCleaning() {
    commitLiveTranscript();

    const full = normalizeTranscriptText(fullTranscript);
    const manual = normalizeTranscriptText(manualTranscriptInput.value);

    return full || manual;
  }

  function getCleanTranscriptForSending() {
    commitLiveTranscript();

    const cleaned = normalizeTranscriptText(cleanedTranscriptInput.value);
    const full = normalizeTranscriptText(fullTranscript);
    const manual = normalizeTranscriptText(manualTranscriptInput.value);

    if (cleaned) return { text: cleaned, source: 'cleanedTranscriptInput' };
    if (full) return { text: full, source: 'fullTranscript' };
    if (manual) return { text: manual, source: 'manualTranscriptInput' };

    return { text: '', source: '' };
  }

  function hasTranscriptForRawActions() {
    return Boolean(
      normalizeTranscriptText(fullTranscript)
      || normalizeTranscriptText(liveTranscript)
      || normalizeTranscriptText(manualTranscriptInput.value)
    );
  }

  function hasTranscriptForCleanSend() {
    return Boolean(
      normalizeTranscriptText(cleanedTranscriptInput.value)
      || normalizeTranscriptText(fullTranscript)
      || normalizeTranscriptText(liveTranscript)
      || normalizeTranscriptText(manualTranscriptInput.value)
    );
  }

  function setNotice(state, message) {
    const stateText = {
      checking: 'Checking',
      ready: 'Ready',
      warning: 'Warning'
    };

    transcriptionState.textContent = stateText[state] || 'Status';
    transcriptionState.className = state === 'ready'
      ? 'status-badge status-completed'
      : state === 'warning'
        ? 'status-badge status-escalated'
        : 'status-badge status-draft';

    transcriptionNotice.className = state === 'warning'
      ? 'notice-strip notice-warning'
      : 'notice-strip';

    transcriptionNotice.querySelector('span').textContent = message;
  }

  function setStatusBadge(element, isAvailable, availableText, unavailableText) {
    if (!element) return;

    element.classList.toggle('is-up', !!isAvailable);
    element.classList.toggle('is-down', !isAvailable);
  }

  function showCleanupNotice(state, message) {
    cleanupNotice.className = state === 'warning'
      ? 'notice-strip notice-warning'
      : 'notice-strip';
    cleanupNotice.querySelector('span').textContent = message;
  }

  function hideCleanupNotice() {
    cleanupNotice.className = 'notice-strip notice-hidden';
    cleanupNotice.querySelector('span').textContent = '';
  }

  async function fetchAiJson(url, options) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 110000);

    try {
      const response = await fetch(window.apiUrl(url), { ...options, credentials: 'include', signal: controller.signal });
      const body = await response.text();
      let data;

      try {
        data = body ? JSON.parse(body) : null;
      } catch (error) {
        throw new Error('The AI service returned an invalid response. Please try again.');
      }

      if (!data || typeof data !== 'object') {
        throw new Error('The AI service returned an empty response. Please try again.');
      }

      return { response, data };
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('The AI request timed out. Please try again in a moment.');
      }

      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function setButtonBusy(button, isBusy, busyLabel) {
    if (!button) return;

    const labelNode = Array.from(button.childNodes)
      .find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());

    if (!labelNode) return;
    if (!button.dataset.idleLabel) button.dataset.idleLabel = labelNode.textContent.trim();
    labelNode.textContent = `\n      ${isBusy ? busyLabel : button.dataset.idleLabel}\n    `;
    button.setAttribute('aria-busy', String(isBusy));
  }

});

// Done by: Khin (25036933)
// Convert microphone audio samples into the binary format expected by the transcription service.
function buildAudioPacket(samples, sampleRate) {
  const metadata = {
    sampleRate,
    channels: 1,
    format: 'pcm_s16le',
    frames: samples.length
  };
  const metadataBytes = new TextEncoder().encode(JSON.stringify(metadata));
  const audioBytes = floatToPcm16(samples);
  const packet = new ArrayBuffer(4 + metadataBytes.length + audioBytes.byteLength);
  const packetView = new DataView(packet);

  packetView.setUint32(0, metadataBytes.length, true);
  new Uint8Array(packet, 4, metadataBytes.length).set(metadataBytes);
  new Uint8Array(packet, 4 + metadataBytes.length).set(new Uint8Array(audioBytes));

  return packet;
}

function floatToPcm16(samples) {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);

  samples.forEach((sample, index) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    const value = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(index * 2, value, true);
  });

  return buffer;
}
