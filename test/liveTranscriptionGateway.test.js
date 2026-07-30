const test = require('node:test');
const assert = require('node:assert/strict');
const {
  _private
} = require('../services/liveTranscriptionGateway');

test('live transcription gateway preserves the transcript payload contract', () => {
  assert.deepEqual(
    _private.createTranscriptMessage({
      transcript: 'Fire reported at Block 10.',
      isFinal: false
    }),
    {
      type: 'transcript',
      transcript: 'Fire reported at Block 10.',
      isFinal: false
    }
  );

  assert.deepEqual(
    _private.createTranscriptMessage({
      transcript: 'Fire reported at Block 10.',
      isFinal: true
    }),
    {
      type: 'transcript',
      transcript: 'Fire reported at Block 10.',
      isFinal: true
    }
  );
});

test('live transcription gateway parses valid messages and rejects malformed JSON', () => {
  assert.deepEqual(
    _private.parseClientMessage(Buffer.from('{"type":"stop"}')),
    { type: 'stop' }
  );
  assert.equal(_private.parseClientMessage(Buffer.from('{not-json')), null);
});
