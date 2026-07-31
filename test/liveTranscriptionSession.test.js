const test = require('node:test');
const assert = require('node:assert/strict');
const { createLiveTranscriptionSession } = require('../public/js/liveTranscriptionSession');

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function createFakeTimers() {
  const timers = [];
  const delays = [];
  return {
    setTimer(callback, delay) {
      timers.push(callback);
      delays.push(delay);
      return timers.length - 1;
    },
    clearTimer(timerId) {
      timers[timerId] = null;
    },
    runNext() {
      const timerIndex = timers.findIndex((timer) => typeof timer === 'function');
      const callback = timerIndex >= 0 ? timers[timerIndex] : null;
      if (timerIndex >= 0) timers[timerIndex] = null;
      if (callback) callback();
    },
    delays
  };
}

test('starting twice while the first session is connecting creates only one session', async () => {
  const deferred = createDeferred();
  let starts = 0;
  const session = createLiveTranscriptionSession({
    startSession: () => {
      starts += 1;
      return deferred.promise;
    }
  });

  const firstStart = session.start();
  const secondStart = await session.start();
  assert.equal(secondStart, false);
  assert.equal(starts, 1);

  deferred.resolve({});
  assert.equal(await firstStart, true);
  assert.equal(session.isRecording(), true);
});

test('stop sends a flush request, cleans audio once, and finishes on the server ended event', async () => {
  let callbacks;
  let cleanupCount = 0;
  let closeCount = 0;
  let stopCount = 0;
  const completed = [];
  const timers = createFakeTimers();
  const session = createLiveTranscriptionSession({
    startSession: (nextCallbacks) => {
      callbacks = nextCallbacks;
      return {
        sendStop() { stopCount += 1; },
        cleanupAudio() { cleanupCount += 1; },
        close() { closeCount += 1; }
      };
    },
    onComplete: (reason) => completed.push(reason),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer
  });

  assert.equal(await session.start(), true);
  assert.equal(session.stop(), true);
  assert.equal(stopCount, 1);
  assert.equal(session.getPhase(), 'stopping');
  callbacks.onEnded();

  assert.equal(session.getPhase(), 'idle');
  assert.equal(cleanupCount, 1);
  assert.equal(closeCount, 1);
  assert.deepEqual(completed, ['ended']);
});

test('start, stop, and start again creates independent sessions after cleanup', async () => {
  const callbacks = [];
  const sessions = [];
  const session = createLiveTranscriptionSession({
    startSession: (nextCallbacks) => {
      callbacks.push(nextCallbacks);
      const resource = {
        sendStop() {},
        cleanupAudio() {},
        close() {}
      };
      sessions.push(resource);
      return resource;
    }
  });

  assert.equal(await session.start(), true);
  assert.equal(session.stop(), true);
  callbacks[0].onEnded();
  assert.equal(session.getPhase(), 'idle');

  assert.equal(await session.start(), true);
  assert.equal(callbacks.length, 2);
  assert.equal(sessions.length, 2);
  assert.equal(session.isRecording(), true);
});

test('an unexpected close leaves the controller idle and preserves a bounded recovery path', async () => {
  let callbacks;
  const errors = [];
  const completed = [];
  const session = createLiveTranscriptionSession({
    startSession: (nextCallbacks) => {
      callbacks = nextCallbacks;
      return { cleanupAudio() {}, close() {} };
    },
    onError: (error) => errors.push(error.message),
    onComplete: (reason) => completed.push(reason)
  });

  assert.equal(await session.start(), true);
  callbacks.onClose();
  assert.equal(session.getPhase(), 'idle');
  assert.deepEqual(completed, ['closed']);
  assert.deepEqual(errors, ['Live transcription connection closed.']);
});

test('the recording limit requests stop and the final flush timeout remains bounded', async () => {
  let callbacks;
  let stopCount = 0;
  const completed = [];
  const timers = createFakeTimers();
  const session = createLiveTranscriptionSession({
    startSession: (nextCallbacks) => {
      callbacks = nextCallbacks;
      return {
        sendStop() { stopCount += 1; },
        cleanupAudio() {},
        close() {}
      };
    },
    onComplete: (reason) => completed.push(reason),
    maxRecordingMs: 40000,
    stopTimeoutMs: 5000,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer
  });

  assert.equal(await session.start(), true);
  assert.equal(timers.delays[0], 40000);
  timers.runNext();
  assert.equal(stopCount, 1);
  assert.equal(session.getPhase(), 'stopping');
  assert.equal(timers.delays[1], 5000);
  timers.runNext();
  assert.deepEqual(completed, ['timeout']);
  assert.equal(session.getPhase(), 'idle');
  assert.equal(typeof callbacks.onEnded, 'function');
});
