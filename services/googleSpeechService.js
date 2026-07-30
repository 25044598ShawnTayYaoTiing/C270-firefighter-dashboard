const { SpeechClient } = require('@google-cloud/speech');
const { AwsClient } = require('google-auth-library');
const { fromNodeProviderChain } = require('@aws-sdk/credential-providers');

const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const MIN_SAMPLE_RATE_HERTZ = 8000;
const MAX_SAMPLE_RATE_HERTZ = 48000;

let clientFactory = (options) => new SpeechClient(options);
let awsCredentialProviderFactory = () => fromNodeProviderChain();
let awsClientFactory = (options) => new AwsClient(options);
let client;

const AWS_WIF_AUDIENCE = '//iam.googleapis.com/projects/981601006380/locations/global/workloadIdentityPools/aws-ecs-firefighter/providers/aws-ecs-provider';
const AWS_WIF_IMPERSONATION_URL = 'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/firefighter-stt@project-1e4380d5-44ee-49d4-b26.iam.gserviceaccount.com:generateAccessToken';

class SpeechServiceError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'SpeechServiceError';
    this.code = options.code;
    this.kind = options.kind || 'service';
  }
}

function getClient() {
  if (!client) {
    const projectId = String(process.env.GOOGLE_CLOUD_PROJECT || '').trim() || undefined;
    client = isAwsWifMode()
      ? clientFactory({ projectId, auth: createAwsWifClient() })
      : clientFactory({ projectId });
  }

  return client;
}

function isAwsWifMode() {
  return String(process.env.GOOGLE_AUTH_MODE || '').trim().toLowerCase() === 'aws-wif';
}

function getAwsRegion() {
  const region = String(process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || '').trim();
  if (!region) throw new SpeechServiceError('AWS region is required for Google Workload Identity Federation.', { kind: 'configuration' });
  return region;
}

function createAwsWifClient() {
  if (process.env.AWS_ACCESS_KEY_ID || process.env.AWS_SECRET_ACCESS_KEY || process.env.AWS_SESSION_TOKEN) {
    throw new SpeechServiceError('Static AWS credential environment variables are not permitted in aws-wif mode.', { kind: 'configuration' });
  }
  const credentialsProvider = awsCredentialProviderFactory();
  return awsClientFactory({
    type: 'external_account',
    audience: AWS_WIF_AUDIENCE,
    subject_token_type: 'urn:ietf:params:aws:token-type:aws4_request',
    token_url: 'https://sts.googleapis.com/v1/token',
    service_account_impersonation_url: AWS_WIF_IMPERSONATION_URL,
    aws_security_credentials_supplier: {
      getAwsRegion: async () => getAwsRegion(),
      getAwsSecurityCredentials: async () => {
        try {
          const credentials = await credentialsProvider();
          if (!credentials.accessKeyId || !credentials.secretAccessKey || !credentials.sessionToken) {
            throw new Error('Temporary task-role credentials were not available.');
          }
          return {
            accessKeyId: credentials.accessKeyId,
            secretAccessKey: credentials.secretAccessKey,
            sessionToken: credentials.sessionToken
          };
        } catch (error) {
          throw new SpeechServiceError('Unable to obtain temporary ECS Task Role credentials.', { kind: 'authentication' });
        }
      }
    }
  });
}

async function checkHealth() {
  try {
    const activeClient = getClient();
    // This resolves the project through ADC/environment metadata without calling
    // the Speech API or logging credentials/tokens.
    await activeClient.auth.getProjectId();
    return { available: true, provider: 'Google Cloud Speech-to-Text V1' };
  } catch (error) {
    return {
      available: false,
      provider: 'Google Cloud Speech-to-Text V1',
      error: isAwsWifMode()
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

function classifyError(error) {
  if (error instanceof SpeechServiceError) return error;

  const code = Number(error && error.code);
  if (code === 16 || code === 7) {
    return new SpeechServiceError('Google Cloud authentication or permissions failed.', { code, kind: 'authentication' });
  }
  if (code === 8) {
    return new SpeechServiceError('Google Speech-to-Text quota is temporarily exhausted. Please try again later.', { code, kind: 'quota' });
  }
  if (code === 3 || code === 9 || code === 11) {
    return new SpeechServiceError('Google Speech-to-Text rejected this audio format.', { code, kind: 'unsupported' });
  }
  if (code === 4 || code === 14 || code === 2) {
    return new SpeechServiceError('Google Speech-to-Text is temporarily unavailable. Please try again.', { code, kind: 'network' });
  }

  return new SpeechServiceError('Speech-to-Text transcription failed. Please try again.', { code, kind: 'service' });
}

function startStreamingRecognition({ sampleRateHertz, onResult, onError, onEnd }) {
  const sampleRate = validateSampleRate(sampleRateHertz);
  let recognitionStream;

  try {
    recognitionStream = getClient().streamingRecognize({
      config: {
        encoding: 'LINEAR16',
        sampleRateHertz: sampleRate,
        languageCode: 'en-SG',
        audioChannelCount: 1,
        enableAutomaticPunctuation: true
      },
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
  recognitionStream.on('error', (error) => onError(classifyError(error)));
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
      config: {
        encoding: 'LINEAR16',
        sampleRateHertz: sampleRate,
        languageCode: 'en-SG',
        audioChannelCount: 1,
        enableAutomaticPunctuation: true
      }
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
    resetClientFactory() {
      clientFactory = (options) => new SpeechClient(options);
      awsCredentialProviderFactory = () => fromNodeProviderChain();
      awsClientFactory = (options) => new AwsClient(options);
      client = null;
    },
    setClientFactory(factory) {
      clientFactory = factory;
      client = null;
    },
    setAwsCredentialProviderFactory(factory) {
      awsCredentialProviderFactory = factory;
      client = null;
    },
    setAwsClientFactory(factory) {
      awsClientFactory = factory;
      client = null;
    }
  }
};
