const { GetCallerIdentityCommand, STSClient } = require('@aws-sdk/client-sts');
const { fromNodeProviderChain } = require('@aws-sdk/credential-providers');
const { AwsClient } = require('google-auth-library');
const {
  serializeError
} = require('../helpers/safeDiagnostics');

const ECS_AWS_REGION = 'ap-southeast-1';
const AWS_WIF_AUDIENCE = '//iam.googleapis.com/projects/981601006380/locations/global/workloadIdentityPools/aws-ecs-firefighter/providers/aws-ecs-provider';
const AWS_WIF_IMPERSONATION_URL = 'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/firefighter-stt@project-1e4380d5-44ee-49d4-b26.iam.gserviceaccount.com:generateAccessToken';

let awsCredentialProviderFactory = () => fromNodeProviderChain();
let awsClientFactory = (options) => new AwsClient(options);
let stsClientFactory = (options) => new STSClient(options);

class GoogleWifAuthError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'GoogleWifAuthError';
    this.kind = options.kind || 'authentication';
  }
}

function logWif(stage, details = {}) {
  console.info('[SpeechToText][AWS-WIF]', { stage, ...details });
}

function logWifError(stage, error) {
  console.error('[SpeechToText][AWS-WIF] authentication failure', {
    stage,
    error: serializeError(error)
  });
}

function isAwsWifMode() {
  return String(process.env.GOOGLE_AUTH_MODE || '').trim().toLowerCase() === 'aws-wif';
}

function getAwsRegion() {
  const region = String(
    process.env.AWS_REGION
      || process.env.AWS_DEFAULT_REGION
      || ECS_AWS_REGION
  ).trim();

  if (region !== ECS_AWS_REGION) {
    throw new GoogleWifAuthError(
      `AWS region must be ${ECS_AWS_REGION} for Google Workload Identity Federation.`,
      { kind: 'configuration' }
    );
  }

  return region;
}

function getCredentialSource() {
  if (process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI) {
    return 'ecs-container-relative-uri';
  }

  if (process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI) {
    return 'ecs-container-full-uri';
  }

  return 'aws-sdk-default-provider-chain';
}

function assertNoStaticAwsCredentials() {
  if (process.env.AWS_ACCESS_KEY_ID
    || process.env.AWS_SECRET_ACCESS_KEY
    || process.env.AWS_SESSION_TOKEN) {
    throw new GoogleWifAuthError(
      'Static AWS credential environment variables are not permitted in aws-wif mode.',
      { kind: 'configuration' }
    );
  }
}

async function resolveTaskRoleCredentials(credentialsProvider, credentialSource) {
  try {
    logWif('ecs-task-role-credentials-requested', { credentialSource });
    const credentials = await credentialsProvider();

    if (!credentials.accessKeyId
      || !credentials.secretAccessKey
      || !credentials.sessionToken) {
      throw new Error('Temporary task-role credentials were not available.');
    }

    try {
      const identity = await stsClientFactory({
        region: getAwsRegion(),
        credentials
      }).send(new GetCallerIdentityCommand({}));
      logWif('aws-caller-identity-resolved', { roleArn: identity.Arn });
    } catch (identityError) {
      console.warn('[SpeechToText][AWS-WIF]', {
        stage: 'aws-caller-identity-unavailable',
        error: serializeError(identityError)
      });
    }

    logWif('ecs-task-role-credentials-resolved', {
      credentialSource,
      temporarySession: Boolean(credentials.sessionToken),
      expirationAvailable: Boolean(credentials.expiration)
    });

    return {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      token: credentials.sessionToken
    };
  } catch (error) {
    logWifError('ecs-task-role-credential-resolution', error);
    throw new GoogleWifAuthError(
      'Unable to obtain temporary ECS Task Role credentials.',
      { cause: error }
    );
  }
}

function createAwsWifClient() {
  assertNoStaticAwsCredentials();

  const credentialSource = getCredentialSource();
  const region = getAwsRegion();
  const credentialsProvider = awsCredentialProviderFactory();

  logWif('credential-source-detected', { credentialSource, region });

  return awsClientFactory({
    type: 'external_account',
    audience: AWS_WIF_AUDIENCE,
    subject_token_type: 'urn:ietf:params:aws:token-type:aws4_request',
    token_url: 'https://sts.googleapis.com/v1/token',
    service_account_impersonation_url: AWS_WIF_IMPERSONATION_URL,
    aws_security_credentials_supplier: {
      getAwsRegion: async () => getAwsRegion(),
      getAwsSecurityCredentials: async () => (
        resolveTaskRoleCredentials(credentialsProvider, credentialSource)
      )
    }
  });
}

async function authenticateSpeechClient(speechClient) {
  logWif('google-sts-token-exchange-started');
  const authClient = await speechClient.auth.getClient();
  await authClient.getAccessToken();
  logWif('service-account-impersonation-completed');
}

function resetFactories() {
  awsCredentialProviderFactory = () => fromNodeProviderChain();
  awsClientFactory = (options) => new AwsClient(options);
  stsClientFactory = (options) => new STSClient(options);
}

module.exports = {
  authenticateSpeechClient,
  createAwsWifClient,
  isAwsWifMode,
  logWif,
  logWifError,
  _private: {
    resetFactories,
    setAwsClientFactory(factory) {
      awsClientFactory = factory;
    },
    setAwsCredentialProviderFactory(factory) {
      awsCredentialProviderFactory = factory;
    },
    setStsClientFactory(factory) {
      stsClientFactory = factory;
    }
  }
};
