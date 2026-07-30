const googleSpeechService = require('../services/googleSpeechService');
const { createToken } = require('../services/liveTranscriptionGateway');

exports.createStreamToken = (req, res) => {
  return res.json({ token: createToken(req.currentOfficer.officer_id) });
};

exports.speechHealth = async (req, res) => {
  const health = await googleSpeechService.checkHealth();
  const status = health.available ? 200 : 503;
  return res.status(status).json({
    status: health.available ? 'ok' : 'unavailable',
    service: 'Google Cloud Speech-to-Text V1',
    authentication: health.available ? 'available' : 'unavailable'
  });
};

function getStatusForError(error) {
  switch (error && error.kind) {
    case 'validation':
    case 'unsupported':
      return 400;
    case 'configuration':
    case 'authentication':
      return 503;
    case 'quota':
      return 429;
    case 'network':
      return 503;
    default:
      return 502;
  }
}

exports.transcribe = async (req, res) => {
  try {
    const transcript = await googleSpeechService.transcribeLinear16({
      audioBase64: req.body && req.body.audio,
      sampleRateHertz: req.body && req.body.sampleRateHertz
    });

    return res.json({ transcript });
  } catch (error) {
    const status = getStatusForError(error);
    if (status >= 500) {
      console.error('[SpeechToText] transcription failed', {
        kind: error && error.kind,
        code: error && error.code,
        error: googleSpeechService._private.serializeError(error)
      });
    }
    return res.status(status).json({ error: error && error.message || 'Transcription failed.' });
  }
};
