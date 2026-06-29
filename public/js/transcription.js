document.addEventListener('DOMContentLoaded', () => {
  const TRANSCRIPT_STORAGE_KEY = 'firefighter.transcriptDraft';
  const serviceWsUrl = 'ws://localhost:8010/ws/transcribe';

  const startButton = document.getElementById('startTranscriptionButton');
  if (!startButton) return;

  const stopButton = document.getElementById('stopTranscriptionButton');
  const clearButton = document.getElementById('clearTranscriptButton');
  const cleanButton = document.getElementById('cleanTranscriptButton');
  const sendButton = document.getElementById('sendTranscriptButton');
  const sendCleanButton = document.getElementById('sendCleanTranscriptButton');
  const transcriptDisplay = document.getElementById('transcriptDisplay');
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
  const finalSegments = new Map();
  const realtimeSegments = new Map();

  checkSystemStatus();

  startButton.addEventListener('click', startTranscription);
  stopButton.addEventListener('click', stopTranscription);
  clearButton.addEventListener('click', clearTranscript);
  cleanButton.addEventListener('click', cleanTranscript);
  sendButton.addEventListener('click', sendTranscriptToCreateReport);
  sendCleanButton.addEventListener('click', sendCleanTranscriptToCreateReport);

  async function checkSystemStatus() {
    try {
      const response = await fetch('/system/status', { cache: 'no-store' });
      const status = await response.json();

      setStatusBadge(realtimeServiceStatus, status.realtimeStt && status.realtimeStt.available, 'Online', 'Offline');
      setStatusBadge(aiServiceStatus, status.ai && status.ai.available, 'Online', 'Offline');
      setStatusBadge(databaseStatus, status.database && status.database.connected, 'Connected', 'Error');

      if (status.realtimeStt && status.realtimeStt.available) {
        setNotice('ready', 'Realtime transcription service is online.');
      } else {
        setNotice('warning', 'Realtime transcription service is currently unavailable. You can still paste a transcript manually.');
      }
    } catch (error) {
      setStatusBadge(realtimeServiceStatus, false, 'Online', 'Offline');
      setStatusBadge(aiServiceStatus, false, 'Online', 'Offline');
      setStatusBadge(databaseStatus, false, 'Connected', 'Error');
      setNotice('warning', 'Realtime transcription service is currently unavailable. You can still paste a transcript manually.');
    }
  }

  async function startTranscription() {
    if (isStreaming) return;

    if (!window.WebSocket || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setNotice('warning', 'This browser cannot stream microphone audio. Manual transcript fallback is available.');
      return;
    }

    try {
      startButton.disabled = true;
      setNotice('checking', 'Connecting to realtime transcription service.');
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
      stopButton.disabled = false;
      setNotice('ready', 'Transcription stream is active.');
    } catch (error) {
      stopTranscription();
      setNotice('warning', 'Realtime transcription service is currently unavailable. You can still paste a transcript manually.');
    } finally {
      startButton.disabled = false;
    }
  }

  function connectSocket() {
    return new Promise((resolve, reject) => {
      const nextSocket = new WebSocket(serviceWsUrl);
      const timeout = window.setTimeout(() => {
        nextSocket.close();
        reject(new Error('Realtime transcription connection timed out.'));
      }, 4000);

      nextSocket.binaryType = 'arraybuffer';

      nextSocket.addEventListener('open', () => {
        window.clearTimeout(timeout);
        resolve(nextSocket);
      });

      nextSocket.addEventListener('message', handleSocketMessage);
      nextSocket.addEventListener('close', () => {
        if (isStreaming) {
          stopTranscription();
          setNotice('warning', 'Realtime transcription service is currently unavailable. You can still paste a transcript manually.');
        }
      });

      nextSocket.addEventListener('error', () => {
        window.clearTimeout(timeout);
        reject(new Error('Realtime transcription service is currently unavailable.'));
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

  function stopTranscription() {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'stop' }));
    }

    isStreaming = false;
    stopButton.disabled = true;
    startButton.disabled = false;

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
  }

  function handleSocketMessage(event) {
    let message;

    try {
      message = JSON.parse(event.data);
    } catch (error) {
      return;
    }

    if (message.type === 'ready' || message.type === 'hello') {
      setNotice('ready', 'Realtime transcription service is online.');
      return;
    }

    if (message.type === 'warning') {
      setNotice('warning', message.message || 'Realtime transcription service reported a warning.');
      return;
    }

    if (message.type === 'error') {
      setNotice('warning', message.message || 'Realtime transcription service reported an error.');
      return;
    }

    if (message.type === 'clear') {
      clearTranscript(false);
      return;
    }

    const text = extractTranscriptText(message);
    if (!text) return;

    const segmentId = getSegmentId(message);

    if (message.type === 'final') {
      finalSegments.set(segmentId, text);
      realtimeSegments.delete(segmentId);
    } else if (message.type === 'realtime') {
      realtimeSegments.set(segmentId, text);
    }

    renderTranscript();
  }

  function extractTranscriptText(message) {
    return message.text || message.transcript || (message.segment && message.segment.text) || '';
  }

  function getSegmentId(message) {
    return message.segmentId || message.segment_id || (message.segment && message.segment.id) || 'current';
  }

  function renderTranscript() {
    const finalText = Array.from(finalSegments.values()).join(' ').trim();
    const realtimeText = Array.from(realtimeSegments.values()).join(' ').trim();
    const combinedText = [finalText, realtimeText].filter(Boolean).join(' ').trim();

    if (!combinedText) {
      transcriptDisplay.innerHTML = '<p class="empty-transcript">No transcript yet.</p>';
      return;
    }

    transcriptDisplay.textContent = combinedText;
  }

  function clearTranscript(sendCommand = true) {
    finalSegments.clear();
    realtimeSegments.clear();
    manualTranscriptInput.value = '';
    cleanedTranscriptInput.value = '';
    hideCleanupNotice();
    renderTranscript();

    if (sendCommand && socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'clear' }));
    }
  }

  async function cleanTranscript() {
    const transcript = getSourceTranscript();

    if (!transcript) {
      showCleanupNotice('warning', 'Add a raw or manual transcript before cleaning.');
      return;
    }

    cleanButton.disabled = true;
    showCleanupNotice('checking', 'Cleaning transcript for review.');

    try {
      const response = await fetch('/api/ai/clean-transcript', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ transcript })
      });
      const data = await response.json();

      cleanedTranscriptInput.value = data.cleanedTranscript || transcript;

      if (data.success) {
        showCleanupNotice('ready', 'Cleaned transcript is ready for review.');
      } else {
        showCleanupNotice('warning', data.error || 'Cleanup failed. You can edit the transcript manually.');
      }
    } catch (error) {
      cleanedTranscriptInput.value = transcript;
      showCleanupNotice('warning', 'Cleanup request failed. You can edit the transcript manually.');
    } finally {
      cleanButton.disabled = false;
    }
  }

  function sendTranscriptToCreateReport() {
    const transcript = getSourceTranscript();

    if (!transcript) {
      setNotice('warning', 'Add transcript text before sending it to Create Report.');
      return;
    }

    localStorage.setItem(TRANSCRIPT_STORAGE_KEY, transcript);
    window.location.href = '/create-report?transcript=sent';
  }

  function sendCleanTranscriptToCreateReport() {
    const transcript = cleanedTranscriptInput.value.trim();

    if (!transcript) {
      showCleanupNotice('warning', 'Clean or manually enter a cleaned transcript before sending.');
      return;
    }

    localStorage.setItem(TRANSCRIPT_STORAGE_KEY, transcript);
    window.location.href = '/create-report?transcript=sent';
  }

  function getSourceTranscript() {
    return (manualTranscriptInput.value || getDisplayedTranscript()).trim();
  }

  function getDisplayedTranscript() {
    const emptyState = transcriptDisplay.querySelector('.empty-transcript');
    return emptyState ? '' : transcriptDisplay.textContent;
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

    element.textContent = isAvailable ? availableText : unavailableText;
    element.className = isAvailable
      ? 'status-badge status-completed'
      : 'status-badge status-escalated';
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
});

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
