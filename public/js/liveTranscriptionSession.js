(function initializeLiveTranscriptionSession(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LiveTranscriptionSession = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const ACTIVE_PHASES = new Set(['starting', 'recording', 'stopping']);

  function createLiveTranscriptionSession(options = {}) {
    const startSession = options.startSession;
    const onResult = options.onResult || (() => {});
    const onComplete = options.onComplete || (() => {});
    const onError = options.onError || (() => {});
    const onStateChange = options.onStateChange || (() => {});
    const setTimer = options.setTimer || setTimeout;
    const clearTimer = options.clearTimer || clearTimeout;
    const maxRecordingMs = Number(options.maxRecordingMs) || 0;
    const stopTimeoutMs = Number(options.stopTimeoutMs) || 5000;

    if (typeof startSession !== 'function') {
      throw new TypeError('A live transcription session starter is required.');
    }

    let phase = 'idle';
    let activeSession = null;
    let generation = 0;
    let recordingTimer = null;
    let stopTimer = null;

    function emitState() {
      onStateChange(phase);
    }

    function clearTimers() {
      if (recordingTimer !== null) clearTimer(recordingTimer);
      if (stopTimer !== null) clearTimer(stopTimer);
      recordingTimer = null;
      stopTimer = null;
    }

    function cleanupAudio(session) {
      if (!session || session.audioCleaned) return;
      session.audioCleaned = true;
      if (typeof session.cleanupAudio === 'function') session.cleanupAudio();
    }

    function closeSocket(session) {
      if (!session || session.socketClosed) return;
      session.socketClosed = true;
      if (typeof session.close === 'function') session.close();
    }

    function finish(reason, token, error) {
      if (token !== generation || phase === 'idle') return false;

      clearTimers();
      const session = activeSession;
      activeSession = null;
      phase = 'finishing';
      emitState();
      cleanupAudio(session);
      closeSocket(session);
      phase = 'idle';
      emitState();
      onComplete(reason, error);
      return true;
    }

    function handleSessionError(error, token) {
      if (token !== generation || phase === 'idle') return;

      onError(error);
      if (phase === 'starting') {
        finish('error', token, error);
        return;
      }
      finish('error', token, error);
    }

    function handleSessionEnded(token) {
      finish('ended', token);
    }

    function handleSessionClosed(token) {
      if (token !== generation || phase === 'idle') return;

      const error = new Error('Live transcription connection closed.');
      if (phase === 'starting') onError(error);
      else if (phase === 'recording') onError(error);
      finish('closed', token, error);
    }

    async function start() {
      if (phase !== 'idle') return false;

      const token = ++generation;
      phase = 'starting';
      emitState();

      let session;
      try {
        session = await startSession({
          onResult: (result) => {
            if (token === generation && (phase === 'recording' || phase === 'stopping')) {
              onResult(result);
            }
          },
          onEnded: () => handleSessionEnded(token),
          onError: (error) => handleSessionError(error, token),
          onClose: () => handleSessionClosed(token)
        });

        if (token !== generation || phase !== 'starting') {
          cleanupAudio(session);
          closeSocket(session);
          return false;
        }

        activeSession = session || {};
        phase = 'recording';
        emitState();

        if (maxRecordingMs > 0) {
          recordingTimer = setTimer(() => stop(), maxRecordingMs);
        }
        return true;
      } catch (error) {
        cleanupAudio(session);
        closeSocket(session);
        if (token === generation) {
          activeSession = null;
          phase = 'idle';
          emitState();
          onError(error);
        }
        return false;
      }
    }

    function sendAudio(audio) {
      if (phase !== 'recording' || !activeSession || typeof activeSession.sendAudio !== 'function') return false;
      try {
        activeSession.sendAudio(audio);
      } catch (error) {
        handleSessionError(error, generation);
        return false;
      }
      return true;
    }

    function stop() {
      if (phase !== 'recording') return false;

      phase = 'stopping';
      emitState();
      cleanupAudio(activeSession);

      if (activeSession && typeof activeSession.sendStop === 'function') {
        try {
          activeSession.sendStop();
        } catch (error) {
          handleSessionError(error, generation);
          return true;
        }
        stopTimer = setTimer(() => finish('timeout', generation), stopTimeoutMs);
      } else {
        finish('stopped', generation);
      }
      return true;
    }

    function cancel() {
      if (!ACTIVE_PHASES.has(phase)) return false;
      return finish('cancelled', generation);
    }

    function isBusy() {
      return ACTIVE_PHASES.has(phase);
    }

    function isRecording() {
      return phase === 'recording';
    }

    function getPhase() {
      return phase;
    }

    return {
      start,
      sendAudio,
      stop,
      cancel,
      isBusy,
      isRecording,
      getPhase
    };
  }

  return { createLiveTranscriptionSession };
}));
