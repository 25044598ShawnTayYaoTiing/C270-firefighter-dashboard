const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const sidebarSource = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'sidebar.js'),
  'utf8'
);

function createSidebarHarness({ savedState = null, storageBlocked = false } = {}) {
  const classes = new Set();
  const attributes = new Map();
  const writes = [];
  let clickHandler;

  const classList = {
    contains(name) {
      return classes.has(name);
    },
    toggle(name, force) {
      const enabled = force === undefined ? !classes.has(name) : Boolean(force);
      if (enabled) classes.add(name);
      else classes.delete(name);
      return enabled;
    }
  };

  const toggle = {
    addEventListener(eventName, handler) {
      if (eventName === 'click') clickHandler = handler;
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    }
  };

  const localStorage = {
    getItem(key) {
      if (storageBlocked) throw new Error('Storage access blocked');
      return key === 'sidebarCollapsed' ? savedState : null;
    },
    setItem(key, value) {
      if (storageBlocked) throw new Error('Storage access blocked');
      writes.push({ key, value });
    }
  };

  vm.runInNewContext(sidebarSource, {
    document: {
      body: { classList },
      getElementById(id) {
        return id === 'sidebarToggle' ? toggle : null;
      }
    },
    localStorage
  });

  return {
    attributes,
    classes,
    click() {
      assert.equal(typeof clickHandler, 'function');
      clickHandler();
    },
    writes
  };
}

test('sidebar restores saved collapse state and persists the next state', () => {
  const harness = createSidebarHarness({ savedState: 'true' });

  assert.equal(harness.classes.has('sidebar-collapsed'), true);
  assert.equal(harness.attributes.get('aria-expanded'), 'false');

  harness.click();

  assert.equal(harness.classes.has('sidebar-collapsed'), false);
  assert.equal(harness.attributes.get('aria-expanded'), 'true');
  assert.deepEqual(harness.writes, [
    { key: 'sidebarCollapsed', value: 'false' }
  ]);
});

test('sidebar restores persisted false as expanded and stores true on the next click', () => {
  const harness = createSidebarHarness({ savedState: 'false' });

  assert.equal(harness.attributes.get('aria-expanded'), 'true');
  assert.equal(harness.classes.has('sidebar-collapsed'), false);

  harness.click();

  assert.deepEqual(harness.writes, [
    { key: 'sidebarCollapsed', value: 'true' }
  ]);
  assert.equal(harness.classes.has('sidebar-collapsed'), true);
  assert.equal(harness.attributes.get('aria-expanded'), 'false');
});

test('sidebar remains usable when browser storage is blocked', () => {
  const harness = createSidebarHarness({ storageBlocked: true });

  assert.doesNotThrow(() => harness.click());
  assert.equal(harness.classes.has('sidebar-collapsed'), true);
  assert.equal(harness.attributes.get('aria-expanded'), 'false');
  assert.deepEqual(harness.writes, []);
});
