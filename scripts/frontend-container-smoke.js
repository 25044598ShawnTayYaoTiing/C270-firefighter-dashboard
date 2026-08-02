'use strict';

// FA contribution owner: Kaung Min Khant
// Purpose: Validates the frontend image, Nginx gateway, runtime BACKEND_URL, health, and WebSocket proxying.
// Demo focus: Show valid traffic succeeding and unsafe runtime configurations failing closed.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const net = require('node:net');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { WebSocket } = require('ws');

// Unique names and bounded waits isolate every smoke run from developer or CI containers.
// A temporary mock backend provides controlled page, API, health, and WebSocket responses.
const PROJECT_ROOT = path.resolve(__dirname, '..');
const RUN_ID = `${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
const IMAGE_NAME = `firefighter-frontend-validation:${RUN_ID}`;
const NETWORK_NAME = `firefighter-frontend-validation-${RUN_ID}`;
const VALID_CONTAINER = `firefighter-frontend-valid-${RUN_ID}`;
const BACKEND_CONTAINER = `firefighter-frontend-backend-${RUN_ID}`;
const INVALID_CONTAINER = `firefighter-frontend-invalid-${RUN_ID}`;
const MISSING_CONTAINER = `firefighter-frontend-missing-${RUN_ID}`;
const INJECTION_CONTAINER = `firefighter-frontend-injection-${RUN_ID}`;
const INVALID_PORT_CONTAINER = `firefighter-frontend-invalid-port-${RUN_ID}`;
const MOCK_BACKEND_IMAGE =
  'node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3';
const STARTUP_TIMEOUT_MS = 60_000;
const REQUEST_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 1_000;

const MOCK_BACKEND_SCRIPT = String.raw`
const crypto = require('node:crypto');
const http = require('node:http');

const server = http.createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (request.url === '/api/container-test') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      proxied: true,
      host: request.headers.host || '',
      forwardedFor: request.headers['x-forwarded-for'] || '',
      forwardedProto: request.headers['x-forwarded-proto'] || ''
    }));
    return;
  }

  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end('<!doctype html><title>Frontend proxy test</title><h1>Mock backend reached</h1>');
});

server.on('upgrade', (request, socket) => {
  if (
    request.url.split('?')[0] !== '/api/transcribe/stream' ||
    String(request.headers.upgrade || '').toLowerCase() !== 'websocket' ||
    !String(request.headers.connection || '').toLowerCase().includes('upgrade')
  ) {
    socket.destroy();
    return;
  }

  const websocketKey = request.headers['sec-websocket-key'];
  const accept = crypto
    .createHash('sha1')
    .update(websocketKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
  const handshake = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    'Sec-WebSocket-Accept: ' + accept,
    '',
    ''
  ].join('\r\n');
  const payload = Buffer.from('gateway-ready');
  const frame = Buffer.concat([Buffer.from([0x81, payload.length]), payload]);

  socket.write(handshake);
  socket.write(frame);
  setTimeout(() => socket.end(), 500);
});

server.listen(3000, '0.0.0.0');
`;

let cleanupStarted = false;

// Docker command and readiness helpers collect actionable output without invoking a shell.
// Once containers are ready, focused assertions inspect runtime behavior and image contents.
function formatCommand(executable, args) {
  return [executable, ...args].join(' ');
}

function runCommand(executable, args, options = {}) {
  const {
    allowFailure = false,
    capture = false,
    quiet = false
  } = options;

  if (!quiet) {
    console.log(`> ${formatCommand(executable, args)}`);
  }

  const result = spawnSync(executable, args, {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });

  if (result.error) {
    throw new Error(`Could not run ${executable}: ${result.error.message}`);
  }

  if (result.status !== 0 && !allowFailure) {
    if (capture) {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    }
    throw new Error(`${formatCommand(executable, args)} exited with code ${result.status}.`);
  }

  return result;
}

function runDocker(args, options = {}) {
  return runCommand('docker', args, options);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function reserveFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : null;

      server.close((error) => {
        if (error) reject(error);
        else if (!port) reject(new Error('Could not allocate a frontend test port.'));
        else resolve(port);
      });
    });
  });
}

async function request(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        'User-Agent': 'firefighter-frontend-container-test'
      }
    });

    return {
      body: await response.text(),
      headers: Object.fromEntries(response.headers.entries()),
      status: response.status
    };
  } catch (error) {
    return {
      error: error && error.message ? error.message : 'request failed',
      headers: {},
      status: 0
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForHttp(label, url, predicate) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  let lastResult = { status: 0, error: 'not attempted' };

  while (Date.now() < deadline) {
    lastResult = await request(url);
    if (predicate(lastResult)) {
      console.log(`[PASS] ${label} (HTTP ${lastResult.status})`);
      return lastResult;
    }
    await delay(POLL_INTERVAL_MS);
  }

  const detail = lastResult.status
    ? `last HTTP status ${lastResult.status}`
    : `last error ${lastResult.error || 'unknown'}`;
  throw new Error(`${label} did not reach the expected state: ${detail}.`);
}

function getContainerState(containerName) {
  const result = runDocker(
    ['inspect', '--format', '{{json .State}}', containerName],
    { capture: true, quiet: true }
  );

  return JSON.parse(result.stdout);
}

async function waitForHealthyContainer(containerName) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  let lastState = 'missing';

  while (Date.now() < deadline) {
    const state = getContainerState(containerName);
    lastState = state.Health ? state.Health.Status : state.Status;

    if (lastState === 'healthy') {
      console.log('[PASS] image-native frontend health check reports healthy');
      return;
    }

    if (state.Status === 'exited' || state.Status === 'dead') {
      const logs = runDocker(['logs', containerName], {
        allowFailure: true,
        capture: true,
        quiet: true
      });
      throw new Error(
        `Frontend exited before becoming healthy.\n${logs.stdout || ''}${logs.stderr || ''}`
      );
    }

    await delay(POLL_INTERVAL_MS);
  }

  throw new Error(`Frontend did not become healthy; last state was ${lastState}.`);
}

// Gateway checks cover WebSocket upgrades plus expected image metadata, files, and Nginx rendering.
// Demo focus: Trace one HTTP/API request and one WebSocket handshake through BACKEND_URL.
function verifyWebSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error('WebSocket proxy test timed out.'));
    }, REQUEST_TIMEOUT_MS);

    socket.once('message', (data) => {
      clearTimeout(timeout);
      const message = data.toString();
      socket.close();

      if (message !== 'gateway-ready') {
        reject(new Error(`Unexpected WebSocket payload: ${message}`));
        return;
      }

      console.log('[PASS] WebSocket upgrade reached the backend through /api/transcribe/stream');
      resolve();
    });

    socket.once('error', (error) => {
      clearTimeout(timeout);
      reject(new Error(`WebSocket proxy failed: ${error.message}`));
    });
  });
}

function assertImageMetadata() {
  const result = runDocker(['image', 'inspect', IMAGE_NAME], {
    capture: true,
    quiet: true
  });
  const [image] = JSON.parse(result.stdout);

  assert.ok(image.Config.ExposedPorts['80/tcp'], 'The image must expose TCP port 80.');
  assert.ok(image.Config.Healthcheck, 'The image must define a health check.');
  assert.match(
    image.Config.Healthcheck.Test.join(' '),
    /127\.0\.0\.1\/health/,
    'The image health check must call the frontend health endpoint.'
  );

  const sizeMiB = (image.Size / 1024 / 1024).toFixed(1);
  const configuredUser = image.Config.User || 'root (entrypoint/master process)';
  console.log(`[PASS] image metadata: ${sizeMiB} MiB, exposed 80/tcp, user ${configuredUser}`);

  const history = runDocker(
    ['history', '--format', '{{.Size}}\\t{{.CreatedBy}}', IMAGE_NAME],
    { capture: true, quiet: true }
  );
  assert.ok(history.stdout.trim(), 'Docker history must return image layers.');
  console.log('[PASS] docker history returned the image layer history');
}

function assertImageContents() {
  runDocker([
    'run',
    '--rm',
    '--entrypoint',
    '/bin/sh',
    IMAGE_NAME,
    '-c',
    [
      'test -f /usr/share/nginx/html/css/style.css',
      'test ! -e /app.js',
      'test ! -e /package.json',
      'test ! -e /.env'
    ].join(' && ')
  ], { capture: true, quiet: true });
  console.log('[PASS] image contains public assets without backend source or local configuration');
}

function assertRenderedNginxConfiguration() {
  const result = runDocker(['exec', VALID_CONTAINER, 'nginx', '-T'], {
    capture: true,
    quiet: true
  });
  const configuration = `${result.stdout}\n${result.stderr}`;

  assert.match(configuration, /proxy_pass http:\/\/backend:3000;/);
  assert.match(configuration, /proxy_set_header Upgrade \$http_upgrade;/);
  assert.match(configuration, /proxy_set_header Connection \$connection_upgrade;/);
  assert.match(configuration, /proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;/);
  assert.match(configuration, /proxy_set_header X-Forwarded-Proto \$scheme;/);
  console.log('[PASS] rendered Nginx config contains backend, forwarding, and WebSocket settings');
}

function assertRuntimeProcesses() {
  const result = runDocker(
    ['exec', VALID_CONTAINER, 'ps', '-o', 'user,pid,ppid,args'],
    { capture: true, quiet: true }
  );

  assert.match(result.stdout, /^root\s+\d+\s+\d+\s+nginx: master process/m);
  assert.match(result.stdout, /^nginx\s+\d+\s+\d+\s+nginx: worker process/m);
  console.log('[PASS] root Nginx master is running with nginx worker processes');
}

// Negative configuration cases prove missing, malformed, injected, or invalid-port origins cannot start.
// These checks demonstrate fail-closed runtime validation without exposing configuration secrets.
function assertRejectedConfiguration(containerName, backendUrl, expectedMessage) {
  const args = ['run', '--name', containerName];
  if (backendUrl !== undefined) {
    args.push('--env', `BACKEND_URL=${backendUrl}`);
  }
  args.push(IMAGE_NAME);

  const result = runDocker(args, {
    allowFailure: true,
    capture: true,
    quiet: true
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;

  assert.notEqual(result.status, 0, `${containerName} should reject its configuration.`);
  assert.match(output, expectedMessage);
  console.log(`[PASS] rejected startup configuration: ${backendUrl || 'missing BACKEND_URL'}`);
}

// Cleanup removes every temporary container, network, and image on normal exit or interruption.
// Demo focus: Confirm the validation leaves no reusable mock service or credentials behind.
function cleanup() {
  if (cleanupStarted) return;
  cleanupStarted = true;

  for (const containerName of [
    VALID_CONTAINER,
    BACKEND_CONTAINER,
    INVALID_CONTAINER,
    MISSING_CONTAINER,
    INJECTION_CONTAINER,
    INVALID_PORT_CONTAINER
  ]) {
    runDocker(['rm', '--force', containerName], {
      allowFailure: true,
      capture: true,
      quiet: true
    });
  }

  runDocker(['network', 'rm', NETWORK_NAME], {
    allowFailure: true,
    capture: true,
    quiet: true
  });
  runDocker(['image', 'rm', '--force', IMAGE_NAME], {
    allowFailure: true,
    capture: true,
    quiet: true
  });
}

function handleSignal(signal) {
  console.error(`\n[INFO] Received ${signal}; cleaning up frontend validation resources.`);
  cleanup();
  process.exit(130);
}

process.once('SIGINT', () => handleSignal('SIGINT'));
process.once('SIGTERM', () => handleSignal('SIGTERM'));

// End-to-end flow builds the image, starts the mock backend, verifies gateway behavior,
// exercises rejected configurations, and reports success only after all cleanup-safe checks pass.
async function main() {
  const frontendPort = await reserveFreePort();
  const frontendOrigin = `http://127.0.0.1:${frontendPort}`;

  console.log(`[INFO] Frontend validation image: ${IMAGE_NAME}`);
  console.log(`[INFO] Temporary frontend port: ${frontendPort}`);
  console.log('[INFO] No cloud credentials, application secrets, database, or live backend are used.');

  runDocker(['info', '--format', '{{.ServerVersion}}'], { capture: true, quiet: true });
  console.log('[PASS] Docker Engine is available');

  runDocker([
    'build',
    '--no-cache',
    '--file',
    'frontend/Dockerfile',
    '--tag',
    IMAGE_NAME,
    '.'
  ]);
  console.log('[PASS] frontend image built successfully');
  assertImageMetadata();
  assertImageContents();

  runDocker(['network', 'create', NETWORK_NAME], { capture: true, quiet: true });
  runDocker([
    'run',
    '--detach',
    '--name',
    BACKEND_CONTAINER,
    '--network',
    NETWORK_NAME,
    '--network-alias',
    'backend',
    '--entrypoint',
    'node',
    MOCK_BACKEND_IMAGE,
    '-e',
    MOCK_BACKEND_SCRIPT
  ], { capture: true, quiet: true });

  runDocker([
    'run',
    '--detach',
    '--name',
    VALID_CONTAINER,
    '--network',
    NETWORK_NAME,
    '--env',
    'BACKEND_URL=http://backend:3000',
    '--publish',
    `127.0.0.1:${frontendPort}:80`,
    '--health-interval',
    '2s',
    '--health-timeout',
    '2s',
    '--health-retries',
    '10',
    '--health-start-period',
    '2s',
    IMAGE_NAME
  ], { capture: true, quiet: true });

  await waitForHealthyContainer(VALID_CONTAINER);

  const health = await waitForHttp(
    'frontend /health',
    `${frontendOrigin}/health`,
    (result) => result.status === 200 && result.body === '{"status":"ok"}'
  );
  assert.equal(health.headers['x-content-type-options'], 'nosniff');
  assert.equal(health.headers['x-frame-options'], 'SAMEORIGIN');
  assert.equal(health.headers['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.doesNotMatch(health.headers.server || '', /\/\d/);
  console.log('[PASS] security headers are present and the Nginx version is hidden');

  const staticAsset = await waitForHttp(
    'frontend static content',
    `${frontendOrigin}/css/style.css`,
    (result) =>
      result.status === 200 &&
      result.body.length > 100 &&
      String(result.headers['content-type'] || '').includes('text/css')
  );
  assert.ok(staticAsset.body.length > 100);

  const rootPage = await waitForHttp(
    'normal frontend request proxy',
    `${frontendOrigin}/login`,
    (result) => result.status === 200 && result.body.includes('Mock backend reached')
  );
  assert.match(rootPage.body, /Mock backend reached/);

  const apiResult = await waitForHttp(
    'frontend API proxy',
    `${frontendOrigin}/api/container-test`,
    (result) => result.status === 200
  );
  const proxyDetails = JSON.parse(apiResult.body);
  assert.equal(proxyDetails.proxied, true);
  assert.equal(proxyDetails.host, 'backend:3000');
  assert.ok(proxyDetails.forwardedFor);
  assert.equal(proxyDetails.forwardedProto, 'http');
  console.log('[PASS] Host, X-Forwarded-For, and X-Forwarded-Proto reached the backend');

  await verifyWebSocket(
    `ws://127.0.0.1:${frontendPort}/api/transcribe/stream?token=test-only`
  );
  assertRenderedNginxConfiguration();
  assertRuntimeProcesses();

  assertRejectedConfiguration(
    INVALID_CONTAINER,
    'abc',
    /BACKEND_URL must be an http:\/\/ or https:\/\//
  );
  assertRejectedConfiguration(
    MISSING_CONTAINER,
    undefined,
    /BACKEND_URL is required/
  );
  assertRejectedConfiguration(
    INJECTION_CONTAINER,
    'http://backend:3000;include-malformed',
    /BACKEND_URL must be a valid origin/
  );
  assertRejectedConfiguration(
    INVALID_PORT_CONTAINER,
    'http://backend:70000',
    /BACKEND_URL port must be between 1 and 65535/
  );

  runDocker(['stop', '--time', '10', VALID_CONTAINER], {
    capture: true,
    quiet: true
  });
  const stoppedState = getContainerState(VALID_CONTAINER);
  assert.equal(stoppedState.Status, 'exited');
  assert.equal(stoppedState.ExitCode, 0);
  console.log('[PASS] frontend container shut down cleanly with exit code 0');

  cleanup();
  console.log('[PASS] frontend validation containers, network, and image were cleaned up');
  console.log('[PASS] focused frontend container validation completed successfully');
}

main()
  .catch((error) => {
    console.error(`[FAIL] ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    cleanup();
  });
