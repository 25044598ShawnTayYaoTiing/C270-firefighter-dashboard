const test = require('node:test');
const assert = require('node:assert/strict');
const transcriptTransfer = require('../public/js/transcriptTransfer');

function createStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); }
  };
}

test('raw and clean transcript handoffs use one versioned contract without mixing sources', () => {
  const storage = createStorage();
  const raw = 'Operator: 995, what is your emergency?\nCaller: Smoke at Block 10.';
  const clean = 'Operator: 995, what is your emergency?\nCaller: Smoke reported at Block 10.';

  assert.deepEqual(
    transcriptTransfer.save(storage, transcriptTransfer.SOURCES.RAW, raw),
    {
      ok: true,
      handoff: {
        version: 1,
        source: 'raw',
        transcript: raw
      }
    }
  );
  assert.deepEqual(transcriptTransfer.consume(storage), {
    version: 1,
    source: 'raw',
    transcript: raw
  });

  transcriptTransfer.save(storage, transcriptTransfer.SOURCES.CLEAN, clean);
  assert.deepEqual(transcriptTransfer.read(storage), {
    version: 1,
    source: 'clean',
    transcript: clean
  });
});

test('transcript handoff preserves whitespace, line breaks, and treats content as data', () => {
  const storage = createStorage();
  const transcript = '  Operator: 995,  what is your emergency?\r\n\r\nCaller: <script>alert(1)</script> at Block 10.  ';
  const result = transcriptTransfer.save(storage, transcriptTransfer.SOURCES.CLEAN, transcript);

  assert.equal(result.ok, true);
  assert.equal(result.handoff.transcript, transcript);
  assert.equal(transcriptTransfer.consume(storage).transcript, result.handoff.transcript);
});

test('empty transcript transfer is rejected before storage or navigation can occur', () => {
  const storage = createStorage();

  assert.deepEqual(
    transcriptTransfer.save(storage, transcriptTransfer.SOURCES.CLEAN, '  \n\t '),
    { ok: false, reason: 'empty' }
  );
  assert.equal(transcriptTransfer.read(storage), null);
});

test('storage failures are reported without pretending transfer succeeded', () => {
  const storage = {
    setItem() { throw new Error('storage unavailable'); },
    getItem() { return null; },
    removeItem() {}
  };

  assert.deepEqual(
    transcriptTransfer.save(storage, transcriptTransfer.SOURCES.RAW, 'Fire reported.'),
    { ok: false, reason: 'storage' }
  );
});
