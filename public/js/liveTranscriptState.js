(function initializeLiveTranscriptState(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LiveTranscriptState = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  function normalize(text) {
    return String(text || '').replace(/\r\n?/g, '\n').trim();
  }

  function joinTranscript(...parts) {
    return parts.map(normalize).filter(Boolean).join(' ');
  }

  function createLiveTranscriptState() {
    let finalTranscript = '';
    let interimTranscript = '';
    let lastFinalResult = '';
    let receivedInterimSinceFinal = false;

    function snapshot() {
      return {
        finalTranscript,
        interimTranscript,
        displayedTranscript: joinTranscript(finalTranscript, interimTranscript)
      };
    }

    function applyResult({ transcript, isFinal }) {
      const text = normalize(transcript);
      if (!text) return snapshot();

      if (isFinal) {
        if (text !== lastFinalResult || receivedInterimSinceFinal) {
          finalTranscript = joinTranscript(finalTranscript, text);
        }
        lastFinalResult = text;
        interimTranscript = '';
        receivedInterimSinceFinal = false;
      } else {
        interimTranscript = text;
        receivedInterimSinceFinal = true;
      }

      return snapshot();
    }

    function finalize() {
      if (interimTranscript) {
        finalTranscript = joinTranscript(finalTranscript, interimTranscript);
        interimTranscript = '';
      }
      receivedInterimSinceFinal = false;
      return snapshot();
    }

    function reset() {
      finalTranscript = '';
      interimTranscript = '';
      lastFinalResult = '';
      receivedInterimSinceFinal = false;
      return snapshot();
    }

    return { applyResult, finalize, reset, snapshot };
  }

  return { createLiveTranscriptState };
}));
