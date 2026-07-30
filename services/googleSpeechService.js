const { SpeechClient } = require('@google-cloud/speech');
const googleWifAuth = require('./googleWifAuth');
const {
  redactSensitive,
  serializeError
} = require('../helpers/safeDiagnostics');

const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const MIN_SAMPLE_RATE_HERTZ = 8000;
const MAX_SAMPLE_RATE_HERTZ = 48000;

let clientFactory = (options) => new SpeechClient(options);
let client;

class SpeechServiceError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'SpeechServiceError';
    this.code = options.code;
    this.kind = options.kind || 'service';
  }
}

function getClient() {
  if (!client) {
    const projectId = String(process.env.GOOGLE_CLOUD_PROJECT || '').trim() || undefined;

    if (googleWifAuth.isAwsWifMode()) {
      googleWifAuth.logWif('speech-client-initialization', {
        projectIdConfigured: Boolean(projectId)
      });
      client = clientFactory({
        projectId,
        authClient: googleWifAuth.createAwsWifClient()
      });
      googleWifAuth.logWif('speech-client-initialized');
    } else {
      client = clientFactory({ projectId });
    }
  }

  return client;
}

async function checkHealth() {
  try {
    const activeClient = getClient();

    if (googleWifAuth.isAwsWifMode()) {
      await googleWifAuth.authenticateSpeechClient(activeClient);
    }

    await activeClient.auth.getProjectId();
    return { available: true, provider: 'Google Cloud Speech-to-Text V1' };
  } catch (error) {
    if (googleWifAuth.isAwsWifMode()) {
      googleWifAuth.logWifError('health-authentication-check', error);
    }

    return {
      available: false,
      provider: 'Google Cloud Speech-to-Text V1',
      error: googleWifAuth.isAwsWifMode()
        ? 'AWS Workload Identity Federation could not authenticate Google Speech-to-Text.'
        : 'Application Default Credentials could not resolve a Google Cloud project.'
    };
  }
}

function decodeAudio(base64Audio) {
  if (typeof base64Audio !== 'string' || !base64Audio.trim()) {
    throw new SpeechServiceError('A non-empty audio recording is required.', { kind: 'validation' });
  }

  const normalized = base64Audio.replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    throw new SpeechServiceError('Audio must be base64-encoded LINEAR16 data.', { kind: 'validation' });
  }

  const audio = Buffer.from(normalized, 'base64');
  if (!audio.length) {
    throw new SpeechServiceError('A non-empty audio recording is required.', { kind: 'validation' });
  }
  if (audio.length > MAX_AUDIO_BYTES) {
    throw new SpeechServiceError('Recording is too large. Record a shorter clip and try again.', { kind: 'validation' });
  }
  if (audio.length % 2 !== 0) {
    throw new SpeechServiceError('Audio must contain 16-bit PCM samples.', { kind: 'validation' });
  }

  return audio;
}

function validateSampleRate(sampleRateHertz) {
  const sampleRate = Number(sampleRateHertz);
  if (!Number.isInteger(sampleRate)
    || sampleRate < MIN_SAMPLE_RATE_HERTZ
    || sampleRate > MAX_SAMPLE_RATE_HERTZ) {
    throw new SpeechServiceError('Unsupported audio sample rate.', { kind: 'validation' });
  }
  return sampleRate;
}

function createRecognitionConfig(sampleRateHertz) {
  return {
    encoding: 'LINEAR16',
    sampleRateHertz,
    languageCode: 'en-SG',
    audioChannelCount: 1,
    enableAutomaticPunctuation: true
  };
}

function classifyError(error) {
  if (error instanceof SpeechServiceError) return error;
  if (error && ['authentication', 'configuration'].includes(error.kind)) {
    return new SpeechServiceError(error.message, {
      kind: error.kind,
      cause: error
    });
  }

  const code = Number(error && error.code);
  if (code === 16 || code === 7) {
    return new SpeechServiceError('Google Cloud authentication or permissions failed.', { code, kind: 'authentication', cause: error });
  }
  if (code === 8) {
    return new SpeechServiceError('Google Speech-to-Text quota is temporarily exhausted. Please try again later.', { code, kind: 'quota', cause: error });
  }
  if (code === 3 || code === 9 || code === 11) {
    return new SpeechServiceError('Google Speech-to-Text rejected this audio format.', { code, kind: 'unsupported', cause: error });
  }
  if (code === 4 || code === 14 || code === 2) {
    return new SpeechServiceError('Google Speech-to-Text is temporarily unavailable. Please try again.', { code, kind: 'network', cause: error });
  }

  return new SpeechServiceError('Speech-to-Text transcription failed. Please try again.', { code, kind: 'service', cause: error });
}

function startStreamingRecognition({ sampleRateHertz, onResult, onError, onEnd }) {
  const sampleRate = validateSampleRate(sampleRateHertz);
  let recognitionStream;

  try {
    recognitionStream = getClient().streamingRecognize({
      config: createRecognitionConfig(sampleRate),
      interimResults: true
    });
  } catch (error) {
    throw classifyError(error);
  }

  recognitionStream.on('data', (response) => {
    (response.results || []).forEach((result) => {
      const transcript = result.alternatives && result.alternatives[0] && result.alternatives[0].transcript;
      if (transcript) onResult({ transcript: transcript.trim(), isFinal: Boolean(result.isFinal) });
    });
  });
  recognitionStream.on('error', (error) => {
    console.error('[SpeechToText] streaming recognition error', {
      name: error && error.name,
      code: error && error.code,
      message: redactSensitive(error && error.message)
    });
    onError(classifyError(error));
  });
  recognitionStream.on('end', () => onEnd());

  return {
    write(audio) {
      if (Buffer.isBuffer(audio) && audio.length && audio.length % 2 === 0) recognitionStream.write(audio);
    },
    end() { recognitionStream.end(); }
  };
}

async function transcribeLinear16({ audioBase64, sampleRateHertz }) {
  const audio = decodeAudio(audioBase64);
  const sampleRate = validateSampleRate(sampleRateHertz);

  try {
    const [response] = await getClient().recognize({
      audio: { content: audio.toString('base64') },
      config: createRecognitionConfig(sampleRate)
    });

    const transcript = (response.results || [])
      .map((result) => result.alternatives && result.alternatives[0] && result.alternatives[0].transcript)
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    return transcript;
  } catch (error) {
    throw classifyError(error);
  }
}

module.exports = {
  SpeechServiceError,
  checkHealth,
  startStreamingRecognition,
  transcribeLinear16,
  _private: {
    redactSensitive,
    serializeError,
    resetClientFactory() {
      clientFactory = (options) => new SpeechClient(options);
      googleWifAuth._private.resetFactories();
      client = null;
    },
    setClientFactory(factory) {
      clientFactory = factory;
      client = null;
    },
    setAwsCredentialProviderFactory(factory) {
      googleWifAuth._private.setAwsCredentialProviderFactory(factory);
      client = null;
    },
    setAwsClientFactory(factory) {
      googleWifAuth._private.setAwsClientFactory(factory);
      client = null;
    },
    setStsClientFactory(factory) {
      googleWifAuth._private.setStsClientFactory(factory);
      client = null;
    }
  }
};
