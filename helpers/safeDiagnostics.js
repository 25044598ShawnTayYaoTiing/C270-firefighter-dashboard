function redactSensitive(value, key = '') {
  if (/(authorization|access.?token|refresh.?token|session.?token|secret|credential|private.?key)/i.test(key)) {
    return '[REDACTED]';
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([nestedKey, nestedValue]) => [
        nestedKey,
        redactSensitive(nestedValue, nestedKey)
      ])
    );
  }

  if (typeof value === 'string') {
    return value
      .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
      .replace(/AKIA[0-9A-Z]{16}/g, '[REDACTED_AWS_ACCESS_KEY]');
  }

  return value;
}

function serializeError(error) {
  if (!error) return null;

  const serialized = {
    name: error.name,
    message: redactSensitive(error.message),
    code: error.code,
    kind: error.kind,
    stack: redactSensitive(error.stack)
  };

  if (error.response) {
    serialized.response = {
      status: error.response.status,
      statusText: error.response.statusText,
      data: redactSensitive(error.response.data)
    };
  }

  if (error.cause && error.cause !== error) {
    serialized.cause = serializeError(error.cause);
  }

  return serialized;
}

module.exports = {
  redactSensitive,
  serializeError
};
