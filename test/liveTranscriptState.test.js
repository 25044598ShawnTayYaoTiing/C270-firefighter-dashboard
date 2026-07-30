const test = require('node:test');
const assert = require('node:assert/strict');
const { createLiveTranscriptState } = require('../public/js/liveTranscriptState');

test('live transcript replaces an interim result instead of appending it', () => {
  const state = createLiveTranscriptState();
  state.applyResult({ transcript: 'Fire reported', isFinal: false });
  const result = state.applyResult({ transcript: 'Fire reported at Block 10', isFinal: false });

  assert.equal(result.finalTranscript, '');
  assert.equal(result.interimTranscript, 'Fire reported at Block 10');
  assert.equal(result.displayedTranscript, 'Fire reported at Block 10');
});

test('live transcript commits a final result and clears the interim result', () => {
  const state = createLiveTranscriptState();
  state.applyResult({ transcript: 'Fire report', isFinal: false });
  const result = state.applyResult({ transcript: 'Fire reported.', isFinal: true });

  assert.equal(result.finalTranscript, 'Fire reported.');
  assert.equal(result.interimTranscript, '');
  assert.equal(result.displayedTranscript, 'Fire reported.');
});

test('multiple interim updates keep only the newest Google hypothesis', () => {
  const state = createLiveTranscriptState();
  state.applyResult({ transcript: 'Unit', isFinal: false });
  state.applyResult({ transcript: 'Unit responding', isFinal: false });
  const result = state.applyResult({ transcript: 'Unit responding now', isFinal: false });

  assert.equal(result.displayedTranscript, 'Unit responding now');
});

test('repeated delivery of the same final result does not duplicate text', () => {
  const state = createLiveTranscriptState();
  state.applyResult({ transcript: 'Proceed to Level 3.', isFinal: true });
  const result = state.applyResult({ transcript: 'Proceed to Level 3.', isFinal: true });

  assert.equal(result.finalTranscript, 'Proceed to Level 3.');
});

test('confirmed final text remains while a new interim result is displayed', () => {
  const state = createLiveTranscriptState();
  state.applyResult({ transcript: 'Smoke observed.', isFinal: true });
  const result = state.applyResult({ transcript: 'Evacuating occupants', isFinal: false });

  assert.equal(result.finalTranscript, 'Smoke observed.');
  assert.equal(result.interimTranscript, 'Evacuating occupants');
  assert.equal(result.displayedTranscript, 'Smoke observed. Evacuating occupants');
});

test('stopping transcription preserves the currently visible interim text', () => {
  const state = createLiveTranscriptState();
  state.applyResult({ transcript: 'Alarm activated.', isFinal: true });
  state.applyResult({ transcript: 'Crew entering unit', isFinal: false });
  const result = state.finalize();

  assert.equal(result.finalTranscript, 'Alarm activated. Crew entering unit');
  assert.equal(result.interimTranscript, '');
  assert.equal(result.displayedTranscript, 'Alarm activated. Crew entering unit');
});
