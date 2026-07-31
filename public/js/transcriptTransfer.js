(function initializeTranscriptTransfer(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TranscriptTransfer = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const STORAGE_KEY = 'firefighter.transcriptHandoff';
  const VERSION = 1;
  const SOURCES = Object.freeze({
    RAW: 'raw',
    CLEAN: 'clean'
  });

  function normalizeTranscript(text) {
    return typeof text === 'string' ? text : String(text || '');
  }

  function createHandoff(source, text) {
    const transcript = normalizeTranscript(text);
    if (![SOURCES.RAW, SOURCES.CLEAN].includes(source) || !transcript.trim()) return null;

    return {
      version: VERSION,
      source,
      transcript
    };
  }

  function save(storage, source, text) {
    const handoff = createHandoff(source, text);
    if (!handoff) return { ok: false, reason: 'empty' };

    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(handoff));
      return { ok: true, handoff };
    } catch (error) {
      return { ok: false, reason: 'storage' };
    }
  }

  function read(storage) {
    try {
      const serialized = storage.getItem(STORAGE_KEY);
      if (!serialized) return null;

      const handoff = JSON.parse(serialized);
      if (!handoff || handoff.version !== VERSION) return null;
      if (![SOURCES.RAW, SOURCES.CLEAN].includes(handoff.source)) return null;

      const transcript = normalizeTranscript(handoff.transcript);
      if (!transcript.trim()) return null;

      return {
        version: VERSION,
        source: handoff.source,
        transcript
      };
    } catch (error) {
      return null;
    }
  }

  function consume(storage) {
    const handoff = read(storage);
    clear(storage);
    return handoff;
  }

  function clear(storage) {
    try {
      storage.removeItem(STORAGE_KEY);
      return true;
    } catch (error) {
      return false;
    }
  }

  return {
    STORAGE_KEY,
    SOURCES,
    normalizeTranscript,
    createHandoff,
    save,
    read,
    consume,
    clear
  };
}));
