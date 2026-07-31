const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const transcriptTransfer = require('../public/js/transcriptTransfer');

function createElement(value = '') {
  return {
    value,
    dataset: {},
    addEventListener() {},
    dispatchEvent() {}
  };
}

function executeCreateReport({ source, transcript, savedDraft = null }) {
  const elements = {
    transcriptInput: createElement(),
    generateDraftButton: createElement(),
    reportForm: createElement(),
    reportingOfficerId: createElement('officer-1')
  };
  const storageValues = new Map();
  const storage = {
    getItem(key) { return storageValues.has(key) ? storageValues.get(key) : null; },
    setItem(key, value) { storageValues.set(key, value); },
    removeItem(key) { storageValues.delete(key); }
  };
  transcriptTransfer.save(storage, source, transcript);
  if (savedDraft) storage.setItem('firefighter.createReportDraft', JSON.stringify(savedDraft));
  let replacedUrl;
  const window = {
    TranscriptTransfer: transcriptTransfer,
    localStorage: storage,
    location: {
      search: '?transcript=sent',
      pathname: '/create-report',
      hash: ''
    },
    history: {
      replaceState(state, title, url) { replacedUrl = url; }
    },
    addEventListener() {},
    setTimeout() { return 1; },
    clearTimeout() {}
  };
  const document = {
    title: 'Create Report',
    addEventListener(event, callback) {
      if (event === 'DOMContentLoaded') callback();
    },
    getElementById(id) { return elements[id] || null; }
  };
  const context = {
    window,
    document,
    localStorage: storage,
    URLSearchParams,
    Event: class Event {},
    console
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'createReport.js'), 'utf8'),
    context
  );

  return {
    transcriptInput: elements.transcriptInput,
    handoff: transcriptTransfer.read(storage),
    replacedUrl
  };
}

test('Create Report loads the exact raw transcript handoff before draft recovery', () => {
  const transcript = 'Operator: 995, what is your emergency?\nCaller: Smoke at Block 10.';
  const result = executeCreateReport({
    source: transcriptTransfer.SOURCES.RAW,
    transcript
  });

  assert.equal(result.transcriptInput.value, transcript);
  assert.equal(result.transcriptInput.dataset.transcriptSource, 'raw');
  assert.equal(result.handoff, null);
  assert.equal(result.replacedUrl, '/create-report');
});

test('Create Report loads cleaned content without converting it into the raw handoff', () => {
  const clean = 'Operator: 995, what is your emergency?\nCaller: Smoke reported at Block 10.';
  const result = executeCreateReport({
    source: transcriptTransfer.SOURCES.CLEAN,
    transcript: clean
  });

  assert.equal(result.transcriptInput.value, clean);
  assert.equal(result.transcriptInput.dataset.transcriptSource, 'clean');
  assert.equal(result.handoff, null);
});

test('an explicit transcript handoff is not blocked by an older Create Report draft', () => {
  const transcript = 'Operator: 995, what is your emergency?\nCaller: New call details.';
  const result = executeCreateReport({
    source: transcriptTransfer.SOURCES.CLEAN,
    transcript,
    savedDraft: {
      transcript: 'Old draft must not overwrite the incoming call.',
      incidentSummary: 'Old draft'
    }
  });

  assert.equal(result.transcriptInput.value, transcript);
  assert.equal(result.transcriptInput.dataset.transcriptSource, 'clean');
});
