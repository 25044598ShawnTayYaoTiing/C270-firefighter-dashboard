const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { SpeechClient } = require('@google-cloud/speech');
const googleSpeechService = require('../services/googleSpeechService');
const ORIGINAL_AUTH_MODE = process.env.GOOGLE_AUTH_MODE;
const ORIGINAL_AWS_REGION = process.env.AWS_REGION;
const ORIGINAL_AWS_CONTAINER_CREDENTIALS_RELATIVE_URI = process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI;
const ORIGINAL_GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT;
const transcriptionController = require('../controllers/transcriptionController');

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test.afterEach(() => {
  if (ORIGINAL_AUTH_MODE === undefined) delete process.env.GOOGLE_AUTH_MODE;
  else process.env.GOOGLE_AUTH_MODE = ORIGINAL_AUTH_MODE;
  if (ORIGINAL_AWS_REGION === undefined) delete process.env.AWS_REGION;
  else process.env.AWS_REGION = ORIGINAL_AWS_REGION;
  if (ORIGINAL_AWS_CONTAINER_CREDENTIALS_RELATIVE_URI === undefined) delete process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI;
  else process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI = ORIGINAL_AWS_CONTAINER_CREDENTIALS_RELATIVE_URI;
  if (ORIGINAL_GOOGLE_CLOUD_PROJECT === undefined) delete process.env.GOOGLE_CLOUD_PROJECT;
  else process.env.GOOGLE_CLOUD_PROJECT = ORIGINAL_GOOGLE_CLOUD_PROJECT;
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
  delete process.env.AWS_SESSION_TOKEN;
  googleSpeechService._private.resetClientFactory();
});

test('Google Speech V1 transcribes LINEAR16 audio using an ADC client configuration', async () => {
  let request;
  googleSpeechService._private.setClientFactory(() => {
    return {
      auth: { getProjectId: async () => 'adc-project' },
      recognize: async (nextRequest) => {
        request = nextRequest;
        return [{ results: [{ alternatives: [{ transcript: ' Fire at Block 10. ' }] }] }];
      }
    };
  });

  const transcript = await googleSpeechService.transcribeLinear16({
    audioBase64: Buffer.from([0, 0, 1, 0]).toString('base64'),
    sampleRateHertz: 48000
  });

  assert.equal(transcript, 'Fire at Block 10.');
  assert.equal(request.config.encoding, 'LINEAR16');
  assert.equal(request.config.languageCode, 'en-SG');
  assert.equal(request.config.sampleRateHertz, 48000);
});

test('Google Speech V1 rejects empty or unsupported recordings before making a request', async () => {
  await assert.rejects(
    googleSpeechService.transcribeLinear16({ audioBase64: '', sampleRateHertz: 48000 }),
    (error) => error.kind === 'validation'
  );
  await assert.rejects(
    googleSpeechService.transcribeLinear16({ audioBase64: Buffer.from([0, 0]).toString('base64'), sampleRateHertz: 96000 }),
    (error) => error.kind === 'validation'
  );
});

test('Google Speech health uses ADC project resolution without requiring environment variables', async () => {
  googleSpeechService._private.setClientFactory(() => ({
    auth: { getProjectId: async () => 'adc-project' }
  }));
  const health = await googleSpeechService.checkHealth();
  assert.equal(health.available, true);
});

test('Google Speech streaming recognition sends PCM to an interim en-SG LINEAR16 stream and closes cleanly', () => {
  const stream = new EventEmitter();
  stream.writes = [];
  stream.write = (audio) => stream.writes.push(audio);
  stream.end = () => stream.emit('end');
  let request;
  const results = [];
  let ended = false;

  googleSpeechService._private.setClientFactory(() => ({
    streamingRecognize(nextRequest) { request = nextRequest; return stream; }
  }));

  const session = googleSpeechService.startStreamingRecognition({
    sampleRateHertz: 16000,
    onResult: (result) => results.push(result),
    onError: () => assert.fail('stream should not fail'),
    onEnd: () => { ended = true; }
  });

  session.write(Buffer.from([0, 0, 1, 0]));
  stream.emit('data', { results: [{ alternatives: [{ transcript: 'Fire reported' }], isFinal: false }] });
  stream.emit('data', { results: [{ alternatives: [{ transcript: 'Fire reported at Block 123' }], isFinal: true }] });
  session.end();

  assert.equal(request.config.encoding, 'LINEAR16');
  assert.equal(request.config.sampleRateHertz, 16000);
  assert.equal(request.config.languageCode, 'en-SG');
  assert.equal(request.interimResults, true);
  assert.equal(stream.writes.length, 1);
  assert.deepEqual(results, [
    { transcript: 'Fire reported', isFinal: false },
    { transcript: 'Fire reported at Block 123', isFinal: true }
  ]);
  assert.equal(ended, true);
});

test('Google Speech streaming recognition reports stream errors without throwing', () => {
  const stream = new EventEmitter();
  stream.write = () => {};
  stream.end = () => {};
  let observedError;
  let loggedError;
  const originalConsoleError = console.error;
  console.error = (message, metadata) => { loggedError = { message, metadata }; };
  googleSpeechService._private.setClientFactory(() => ({ streamingRecognize: () => stream }));
  try {
    googleSpeechService.startStreamingRecognition({
      sampleRateHertz: 16000,
      onResult: () => {},
      onError: (error) => { observedError = error; },
      onEnd: () => {}
    });
    stream.emit('error', Object.assign(new Error('network failure Bearer sensitive-token'), { code: 14 }));
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(observedError.kind, 'network');
  assert.deepEqual(loggedError, {
    message: '[SpeechToText] streaming recognition error',
    metadata: {
      name: 'Error',
      code: 14,
      message: 'network failure Bearer [REDACTED]'
    }
  });
  assert.doesNotMatch(JSON.stringify(loggedError), /sensitive-token/);
});

test('aws-wif mode uses the ECS credential provider and Google AwsClient without static credentials', async () => {
  let speechOptions;
  let awsOptions;
  const wifAuthClient = { getAccessToken: async () => ({ token: 'test-token' }) };
  process.env.GOOGLE_AUTH_MODE = 'aws-wif';
  process.env.AWS_REGION = 'ap-southeast-1';
  process.env.GOOGLE_CLOUD_PROJECT = 'project-1e4380d5-44ee-49d4-b26';
  process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI = '/v2/credentials/test-task';
  googleSpeechService._private.setAwsCredentialProviderFactory(() => async () => ({
    accessKeyId: 'temporary-access-key', secretAccessKey: 'temporary-secret', sessionToken: 'temporary-session-token'
  }));
  googleSpeechService._private.setStsClientFactory(() => ({
    send: async () => ({ Arn: 'arn:aws:sts::123456789012:assumed-role/FirefighterBackendTaskRole/test-task' })
  }));
  googleSpeechService._private.setAwsClientFactory((options) => { awsOptions = options; return wifAuthClient; });
  googleSpeechService._private.setClientFactory((options) => {
    speechOptions = options;
    return { recognize: async () => [{ results: [] }] };
  });

  await googleSpeechService.transcribeLinear16({ audioBase64: Buffer.from([0, 0]).toString('base64'), sampleRateHertz: 16000 });
  const credentials = await awsOptions.aws_security_credentials_supplier.getAwsSecurityCredentials();

  assert.equal(awsOptions.audience, '//iam.googleapis.com/projects/981601006380/locations/global/workloadIdentityPools/aws-ecs-firefighter/providers/aws-ecs-provider');
  assert.equal(awsOptions.service_account_impersonation_url, 'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/firefighter-stt@project-1e4380d5-44ee-49d4-b26.iam.gserviceaccount.com:generateAccessToken');
  assert.equal(await awsOptions.aws_security_credentials_supplier.getAwsRegion(), 'ap-southeast-1');
  assert.deepEqual(credentials, {
    accessKeyId: 'temporary-access-key',
    secretAccessKey: 'temporary-secret',
    token: 'temporary-session-token'
  });
  assert.equal(Object.hasOwn(credentials, 'sessionToken'), false);
  assert.equal(speechOptions.projectId, 'project-1e4380d5-44ee-49d4-b26');
  assert.equal(speechOptions.authClient, wifAuthClient);
  assert.equal(Object.hasOwn(speechOptions, 'auth'), false);
});

test('aws-wif health wraps the auth client and resolves the explicit project without raw project discovery', async () => {
  let awsOptions;
  let wrappedGoogleAuth;
  let tokenAcquisitions = 0;
  let rawClientProjectLookups = 0;
  const wifAuthClient = {
    getAccessToken: async () => {
      tokenAcquisitions += 1;
      return { token: 'test-token' };
    },
    getProjectId: async () => {
      rawClientProjectLookups += 1;
      throw new Error('Raw AwsClient project lookup must not be used.');
    }
  };
  process.env.GOOGLE_AUTH_MODE = 'aws-wif';
  process.env.GOOGLE_CLOUD_PROJECT = 'project-1e4380d5-44ee-49d4-b26';
  delete process.env.AWS_REGION;
  googleSpeechService._private.setAwsCredentialProviderFactory(() => async () => ({
    accessKeyId: 'temporary-access-key', secretAccessKey: 'temporary-secret', sessionToken: 'temporary-session-token'
  }));
  googleSpeechService._private.setStsClientFactory(() => ({
    send: async () => ({ Arn: 'arn:aws:sts::123456789012:assumed-role/FirefighterBackendTaskRole/test-task' })
  }));
  googleSpeechService._private.setAwsClientFactory((options) => {
    awsOptions = options;
    return wifAuthClient;
  });
  googleSpeechService._private.setClientFactory((options) => {
    const speechClient = new SpeechClient(options);
    wrappedGoogleAuth = speechClient.auth;
    return speechClient;
  });
  const health = await googleSpeechService.checkHealth();
  assert.equal(health.available, true);
  assert.equal(tokenAcquisitions, 1);
  assert.equal(rawClientProjectLookups, 0);
  assert.equal(await wrappedGoogleAuth.getClient(), wifAuthClient);
  assert.equal(await wrappedGoogleAuth.getProjectId(), 'project-1e4380d5-44ee-49d4-b26');
  assert.equal(await awsOptions.aws_security_credentials_supplier.getAwsRegion(), 'ap-southeast-1');
});

test('aws-wif mode masks task-role and federation failures', async () => {
  let awsOptions;
  process.env.GOOGLE_AUTH_MODE = 'aws-wif';
  process.env.AWS_REGION = 'ap-southeast-1';
  googleSpeechService._private.setAwsCredentialProviderFactory(() => async () => { throw new Error('credential source failed'); });
  googleSpeechService._private.setAwsClientFactory((options) => {
    awsOptions = options;
    return {
      getAccessToken: async () => { throw new Error('federation failed'); },
      getProjectId: async () => 'project-1e4380d5-44ee-49d4-b26'
    };
  });
  googleSpeechService._private.setClientFactory((options) => ({
    auth: {
      getClient: async () => options.authClient,
      getProjectId: async () => 'project-1e4380d5-44ee-49d4-b26'
    }
  }));

  const health = await googleSpeechService.checkHealth();
  await assert.rejects(
    awsOptions.aws_security_credentials_supplier.getAwsSecurityCredentials(),
    (error) => error.kind === 'authentication' && error.cause.message === 'credential source failed'
  );
  assert.equal(health.available, false);
  assert.doesNotMatch(health.error, /credential source|temporary-secret|token/i);
});

test('aws-wif diagnostics retain nested errors without including credential material', () => {
  const root = new Error('provider request failed');
  const wrapped = new googleSpeechService.SpeechServiceError('Task role unavailable', {
    kind: 'authentication',
    cause: root
  });
  const serialized = googleSpeechService._private.serializeError(wrapped);
  assert.equal(serialized.cause.message, 'provider request failed');
  assert.equal(JSON.stringify(serialized).includes('accessKeyId'), false);
  assert.deepEqual(
    googleSpeechService._private.redactSensitive({
      access_token: 'token-value',
      authorization: 'Bearer token-value',
      status: 'denied'
    }),
    { access_token: '[REDACTED]', authorization: '[REDACTED]', status: 'denied' }
  );
});

test('transcription controller maps quota and authentication failures without exposing credentials', async () => {
  const originalTranscribe = googleSpeechService.transcribeLinear16;
  try {
    googleSpeechService.transcribeLinear16 = async () => {
      throw Object.assign(new Error('quota'), { kind: 'quota' });
    };
    const quotaResponse = createResponse();
    await transcriptionController.transcribe({ body: { audio: 'AA==', sampleRateHertz: 16000 } }, quotaResponse);
    assert.equal(quotaResponse.statusCode, 429);

    googleSpeechService.transcribeLinear16 = async () => {
      throw Object.assign(new Error('auth'), { kind: 'authentication' });
    };
    const authResponse = createResponse();
    await transcriptionController.transcribe({ body: { audio: 'AA==', sampleRateHertz: 16000 } }, authResponse);
    assert.equal(authResponse.statusCode, 503);
  } finally {
    googleSpeechService.transcribeLinear16 = originalTranscribe;
  }
});

test('speech health endpoint returns only safe availability diagnostics', async () => {
  const originalCheckHealth = googleSpeechService.checkHealth;
  try {
    googleSpeechService.checkHealth = async () => ({
      available: false,
      provider: 'Google Cloud Speech-to-Text V1',
      error: 'sensitive underlying diagnostic'
    });
    const response = createResponse();
    await transcriptionController.speechHealth({}, response);
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.body, {
      status: 'unavailable',
      service: 'Google Cloud Speech-to-Text V1',
      authentication: 'unavailable'
    });
    assert.doesNotMatch(JSON.stringify(response.body), /sensitive underlying diagnostic/);
  } finally {
    googleSpeechService.checkHealth = originalCheckHealth;
  }
});
