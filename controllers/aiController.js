const geminiService = require('../services/geminiService');

// Done BY SHAWN ID 25044598
// AI Features: controller layer for transcript cleanup, report drafting, AI status, and fallback review support.
function getTranscript(req) {
  return req.body && typeof req.body.transcript === 'string'
    ? req.body.transcript.trim()
    : '';
}

function getAiErrorMessage(error, operation) {
  if (error && error.message === 'Gemini AI is not configured.') {
    return 'Gemini AI is not configured. Set GEMINI_API_KEY and GEMINI_MODEL on the server.';
  }

  if (error && error.message === 'Gemini model is not configured.') {
    return 'Gemini AI is not configured. Set GEMINI_MODEL on the server.';
  }

  if (error && error.retryable) {
    return 'The AI service is temporarily busy. Please try again in a moment.';
  }

  if (operation === 'cleanup') {
    return 'Gemini returned an unexpected cleanup response. Please try again or edit the transcript manually.';
  }

  return 'Gemini returned an unexpected report response. Please try again or complete the report manually.';
}

function getAiErrorStatus(error) {
  if (error && error.message && error.message.includes('not configured')) return 503;
  if (error && error.retryable) return 503;
  return 502;
}

function sendError(res, status, payload) {
  const response = typeof res.status === 'function' ? res.status(status) : res;
  return response.json(payload);
}

// Done BY SHAWN ID 25044598
// AI Features: conservative fallback report keeps officer review usable when Gemini AI is unavailable.
function fallbackReport(transcript) {
  // Fallback data stays conservative so officers can manually complete missing details.
  return {
    incident_type: '',
    location: '',
    incident_datetime: '',
    incident_summary: transcript
      ? `Transcript received for officer review: ${transcript.slice(0, 450)}`
      : '',
    hazards: 'Not identified in transcript.',
    injured_or_trapped_persons: 'Not identified in transcript.',
    response_status: 'Pending Review',
    missing_information: 'Report drafting service was unavailable. Officer should confirm incident type, location, date/time, hazards, injuries, and other scene details.',
    officer_notes: 'Manual review required before saving.'
  };
}

// Done BY SHAWN ID 25044598
// AI Features: cleans raw emergency transcripts through the Gemini service before report drafting.
exports.cleanTranscript = async (req, res) => {
  const transcript = getTranscript(req);

  if (!transcript) {
    return res.status(400).json({
      success: false,
      error: 'Transcript is required.'
    });
  }

  try {
    const cleanedTranscript = await geminiService.cleanTranscript(transcript);

    return res.json({
      success: true,
      cleanedTranscript
    });
  } catch (error) {
    return sendError(res, getAiErrorStatus(error), {
      success: false,
      error: getAiErrorMessage(error, 'cleanup'),
      cleanedTranscript: transcript
    });
  }
};

// Done BY SHAWN ID 25044598
// AI Features: generates editable incident report drafts from transcript text for officer review.
exports.generateReport = async (req, res) => {
  const transcript = getTranscript(req);

  if (!transcript) {
    return res.status(400).json({
      success: false,
      error: 'Transcript is required.'
    });
  }

  try {
    const report = await geminiService.generateReport(transcript);

    return res.json({
      success: true,
      // Backdating is always an explicit human action; AI never selects the saved timestamp.
      report: {
        ...report,
        incident_datetime: ''
      }
    });
  } catch (error) {
    return sendError(res, getAiErrorStatus(error), {
      success: false,
      fallback: true,
      error: getAiErrorMessage(error, 'report'),
      report: fallbackReport(transcript)
    });
  }
};

// Done BY SHAWN ID 25044598
// AI Features: exposes Gemini availability and config status to support the AI workflow UI.
exports.getAiStatus = async (req, res) => {
  const health = await geminiService.checkHealth();

  res.json({
    success: health.available,
    available: health.available,
    ai: geminiService.getConfig(),
    lastRequest: health.lastRequest
  });
};
