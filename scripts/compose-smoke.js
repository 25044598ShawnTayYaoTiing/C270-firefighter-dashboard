'use strict';

// FA contribution owner: Kong Ji Xun
// Purpose: Validates Compose build, health ordering, Docker DNS, proxying, failure, recovery, and cleanup.
// Demo focus: Stop the backend, observe degraded routing, recover it, and show the isolated project is removed.

const crypto = require('node:crypto');
const net = require('node:net');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Isolated project names, ports, and bounded timeouts prevent collisions with normal local services.
// The smoke flow creates temporary resources and always targets its own Compose project.
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PROJECT_NAME = `firefighter-compose-smoke-${process.pid}`;
const STARTUP_TIMEOUT_MS = 180_000;
const RECOVERY_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 2_000;
const REQUEST_TIMEOUT_MS = 5_000;

let smokeEnvironment = process.env;
let projectRemoved = false;
let cleanupStarted = false;

// Command wrappers run Docker and Compose without a shell and preserve useful failure output.
// Successful setup proceeds into HTTP, container-health, and network assertions.
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
    env: smokeEnvironment,
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

function composeArgs(args) {
  return [
    'compose',
    '--ansi',
    'never',
    '--project-name',
    PROJECT_NAME,
    '--file',
    'docker-compose.yml',
    ...args
  ];
}

function runCompose(args, options = {}) {
  return runCommand('docker', composeArgs(args), options);
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
        else if (!port) reject(new Error('Could not allocate a local smoke-test port.'));
        else resolve(port);
      });
    });
  });
}

async function reserveDistinctPorts() {
  const frontendPort = await reserveFreePort();
  let backendPort = await reserveFreePort();

  while (backendPort === frontendPort) {
    backendPort = await reserveFreePort();
  }

  return { frontendPort, backendPort };
}

// Bounded HTTP and container-health helpers wait for real readiness rather than fixed sleeps.
// Demo focus: Show backend and frontend health becoming ready in dependency order.
async function request(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        'User-Agent': 'firefighter-compose-smoke-test'
      }
    });
    const body = await response.text();

    return {
      body,
      status: response.status
    };
  } catch (error) {
    return {
      error: error && error.message ? error.message : 'request failed',
      status: 0
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForHttp(label, url, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastResult = { status: 0, error: 'not attempted' };

  while (Date.now() < deadline) {
    lastResult = await request(url);
    if (predicate(lastResult)) {
      const outcome = lastResult.status
        ? `HTTP ${lastResult.status}`
        : `request unavailable: ${lastResult.error || 'connection failed'}`;
      console.log(`[PASS] ${label} (${outcome})`);
      return lastResult;
    }
    await delay(POLL_INTERVAL_MS);
  }

  const detail = lastResult.status
    ? `last HTTP status ${lastResult.status}`
    : `last error ${lastResult.error || 'unknown'}`;
  throw new Error(`${label} did not reach the expected state: ${detail}.`);
}

function hasOkJson(result) {
  if (result.status !== 200) return false;

  try {
    return JSON.parse(result.body).status === 'ok';
  } catch {
    return false;
  }
}

function getContainerId(service) {
  return runCompose(['ps', '--quiet', service], {
    capture: true,
    quiet: true
  }).stdout.trim();
}

function getContainerHealth(service) {
  const containerId = getContainerId(service);
  if (!containerId) return 'missing';

  const result = runDocker([
    'inspect',
    '--format',
    '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}',
    containerId
  ], {
    capture: true,
    quiet: true
  });

  return result.stdout.trim();
}

async function waitForContainerHealth(service, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastState = 'missing';

  while (Date.now() < deadline) {
    lastState = getContainerHealth(service);
    if (lastState === 'healthy') {
      console.log(`[PASS] ${service} container is healthy`);
      return;
    }
    await delay(POLL_INTERVAL_MS);
  }

  throw new Error(`${service} container did not become healthy; last state was ${lastState}.`);
}

// Network assertions prove the frontend can resolve and reach the backend by Docker DNS and internal port.
// The next phase deliberately interrupts the backend and validates recovery through the gateway.
function assertInternalBackendAccess() {
  const dnsResult = runCompose(
    ['exec', '--no-TTY', 'frontend', 'getent', 'hosts', 'backend'],
    { capture: true }
  );

  if (!dnsResult.stdout.trim()) {
    throw new Error('The frontend container could not resolve the backend service name.');
  }
  console.log('[PASS] frontend resolves backend through Compose service DNS');

  const healthResult = runCompose(
    [
      'exec',
      '--no-TTY',
      'frontend',
      'wget',
      '-q',
      '-O',
      '-',
      'http://backend:3000/health'
    ],
    { capture: true }
  );

  let health;
  try {
    health = JSON.parse(healthResult.stdout);
  } catch {
    throw new Error('The frontend container received an invalid backend health response.');
  }

  if (health.status !== 'ok') {
    throw new Error('The frontend container did not receive the expected backend health status.');
  }
  console.log('[PASS] frontend reaches backend:3000 inside the Compose network');
}

// Cleanup is idempotent and also runs on signals so demo containers, networks, and volumes do not linger.
// Demo focus: Confirm the temporary Compose project is absent after success or failure.
function removeSmokeProject(options = {}) {
  if (cleanupStarted) return;
  cleanupStarted = true;

  const result = runCompose(
    ['down', '--remove-orphans', '--rmi', 'local', '--timeout', '15'],
    {
      allowFailure: options.allowFailure,
      quiet: options.quiet
    }
  );

  if (result.status === 0) {
    projectRemoved = true;
  }
}

function handleSignal(signal) {
  console.error(`\n[INFO] Received ${signal}; removing the isolated Compose project.`);
  try {
    removeSmokeProject({ allowFailure: true });
  } finally {
    process.exit(130);
  }
}

process.once('SIGINT', () => handleSignal('SIGINT'));
process.once('SIGTERM', () => handleSignal('SIGTERM'));

// End-to-end flow: reserve ports, build/start, verify DNS and proxying, simulate failure, recover, and clean up.
// Each assertion is deterministic; a failed check exits non-zero for CI or presenter troubleshooting.
async function main() {
  const { frontendPort, backendPort } = await reserveDistinctPorts();

  smokeEnvironment = {
    ...process.env,
    NODE_ENV: 'development',
    FRONTEND_PORT: String(frontendPort),
    BACKEND_PORT: String(backendPort),
    CORS_ORIGIN: `http://127.0.0.1:${frontendPort}`,
    SESSION_SECRET: crypto.randomBytes(48).toString('hex'),
    SESSION_COOKIE_NAME: 'firefighter.compose-smoke',
    DB_HOST: 'compose-smoke.invalid',
    DB_PORT: '3306',
    DB_USER: 'compose_smoke',
    DB_PASSWORD: crypto.randomBytes(32).toString('hex'),
    DB_NAME: 'compose_smoke',
    GEMINI_API_KEY: '',
    GEMINI_MODEL: 'gemini-3.5-flash-lite',
    GEMINI_TIMEOUT_MS: '30000',
    GOOGLE_CLOUD_PROJECT: '',
    GOOGLE_AUTH_MODE: '',
    GOOGLE_APPLICATION_CREDENTIALS: '',
    GOOGLE_APPLICATION_CREDENTIALS_HOST: '',
    ONEMAP_EMAIL: '',
    ONEMAP_PASSWORD: '',
    ONEMAP_BASE_URL: 'https://www.onemap.gov.sg',
    GEOCODING_DEBUG: 'false'
  };

  const backendHealthUrl = `http://127.0.0.1:${backendPort}/health`;
  const frontendHealthUrl = `http://127.0.0.1:${frontendPort}/health`;
  const frontendApplicationUrl = `http://127.0.0.1:${frontendPort}/login`;

  console.log(`[INFO] Compose project: ${PROJECT_NAME}`);
  console.log(`[INFO] Temporary frontend port: ${frontendPort}`);
  console.log(`[INFO] Temporary backend port: ${backendPort}`);
  console.log('[INFO] External database, Gemini, and Google credentials are not used by this smoke test.');

  runDocker(['info', '--format', '{{.ServerVersion}}'], { capture: true });
  console.log('[PASS] Docker Engine is available');

  runCompose(['config', '--quiet']);
  console.log('[PASS] docker compose config');

  runCompose(['build', 'backend', 'frontend']);
  console.log('[PASS] backend and frontend images built');

  runCompose(['up', '--detach']);

  await waitForContainerHealth('backend', STARTUP_TIMEOUT_MS);
  await waitForContainerHealth('frontend', STARTUP_TIMEOUT_MS);
  await waitForHttp('backend /health', backendHealthUrl, hasOkJson, STARTUP_TIMEOUT_MS);
  await waitForHttp('frontend /health', frontendHealthUrl, hasOkJson, STARTUP_TIMEOUT_MS);
  assertInternalBackendAccess();
  await waitForHttp(
    'frontend-to-backend application proxy',
    frontendApplicationUrl,
    (result) => result.status === 200,
    STARTUP_TIMEOUT_MS
  );

  console.log('[INFO] Stopping backend to demonstrate temporary dependency failure.');
  runCompose(['stop', '--timeout', '15', 'backend']);
  await waitForHttp(
    'frontend liveness remains independent',
    frontendHealthUrl,
    hasOkJson,
    30_000
  );
  await waitForHttp(
    'frontend proxy reports backend unavailability',
    frontendApplicationUrl,
    (result) => result.status === 0 || [502, 503, 504].includes(result.status),
    30_000
  );

  console.log('[INFO] Starting backend and verifying communication recovery.');
  runCompose(['start', 'backend']);
  await waitForContainerHealth('backend', RECOVERY_TIMEOUT_MS);
  await waitForHttp('recovered backend /health', backendHealthUrl, hasOkJson, RECOVERY_TIMEOUT_MS);
  assertInternalBackendAccess();
  await waitForHttp(
    'recovered frontend-to-backend application proxy',
    frontendApplicationUrl,
    (result) => result.status === 200,
    RECOVERY_TIMEOUT_MS
  );

  removeSmokeProject();
  const remainingContainers = runCompose(
    ['ps', '--all', '--quiet'],
    { capture: true, quiet: true }
  ).stdout.trim();

  if (remainingContainers) {
    throw new Error('Smoke-test containers remained after docker compose down.');
  }

  const remainingImages = runDocker(
    ['image', 'ls', '--filter', `reference=${PROJECT_NAME}-*`, '--quiet'],
    { capture: true, quiet: true }
  ).stdout.trim();

  if (remainingImages) {
    throw new Error('Smoke-test images remained after docker compose down.');
  }

  console.log('[PASS] isolated containers, network, and images were cleaned up');
  console.log('[PASS] Docker Compose smoke and recovery test completed successfully');
}

main()
  .catch((error) => {
    console.error(`[FAIL] ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    if (!projectRemoved) {
      try {
        removeSmokeProject({ allowFailure: true });
      } catch (cleanupError) {
        console.error(`[WARN] Cleanup failed: ${cleanupError.message}`);
      }
    }
  });
