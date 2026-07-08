const ollamaService = require('../services/ollamaService');

// Done BY SHAWN ID 25044598
// AI Features: controller layer for transcript cleanup, report drafting, Ollama status, and fallback review support.
function getTranscript(req) {
  return req.body && typeof req.body.transcript === 'string'
    ? req.body.transcript.trim()
    : '';
}

function getOptionalText(body, field) {
  return body && typeof body[field] === 'string'
    ? body[field].trim()
    : '';
}

// Done BY SHAWN ID 25044598
// AI Missing Information enhancement: normalizes officer-entered report context before Ollama review.
function getMissingInformationPayload(req) {
  const body = req.body || {};

  return {
    transcript: getOptionalText(body, 'transcript'),
    location: getOptionalText(body, 'location'),
    incident_type: getOptionalText(body, 'incident_type'),
    incident_summary: getOptionalText(body, 'incident_summary'),
    hazards: getOptionalText(body, 'hazards'),
    injured_or_trapped_persons: getOptionalText(body, 'injured_or_trapped_persons'),
    missing_information: getOptionalText(body, 'missing_information')
  };
}

function hasAnyReportDetail(payload) {
  return Object.values(payload).some((value) => value.length > 0);
}

// Done BY SHAWN ID 25044598
// AI Features: conservative fallback report keeps officer review usable when Ollama is unavailable.
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
// AI Features: cleans raw emergency transcripts through the Ollama service before report drafting.
exports.cleanTranscript = async (req, res) => {
  const transcript = getTranscript(req);

  if (!transcript) {
    return res.status(400).json({
      success: false,
      error: 'Transcript is required.'
    });
  }

  try {
    const cleanedTranscript = await ollamaService.cleanTranscript(transcript);

    return res.json({
      success: true,
      cleanedTranscript
    });
  } catch (error) {
    return res.json({
      success: false,
      error: 'Transcript cleanup service is unavailable. Review the transcript manually.',
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
    const report = await ollamaService.generateReport(transcript);

    return res.json({
      success: true,
      report
    });
  } catch (error) {
    return res.json({
      success: false,
      fallback: true,
      error: 'Report drafting service is unavailable. A manual draft was prepared for review.',
      report: fallbackReport(transcript)
    });
  }
};

// Done BY SHAWN ID 25044598
// AI Missing Information enhancement: reviews current report details and returns editable missing-detail bullets.
exports.enhanceMissingInformation = async (req, res) => {
  const payload = getMissingInformationPayload(req);

  if (!hasAnyReportDetail(payload)) {
    return res.status(400).json({
      success: false,
      error: 'Report details are required before enhancing missing information.'
    });
  }

  try {
    const missingInformation = await ollamaService.enhanceMissingInformation(payload);

    return res.json({
      success: true,
      missingInformation
    });
  } catch (error) {
    console.error('[AI Missing Information] Enhancement failed:', error.message);

    return res.status(503).json({
      success: false,
      error: 'Missing information enhancement is unavailable. Please review manually.'
    });
  }
};

// Done BY SHAWN ID 25044598
// AI Features: exposes Ollama availability and config status to support the AI workflow UI.
exports.getOllamaStatus = async (req, res) => {
  const health = await ollamaService.checkHealth();

  res.json({
    success: health.available,
    available: health.available,
    ollama: ollamaService.getConfig()
  });
};
