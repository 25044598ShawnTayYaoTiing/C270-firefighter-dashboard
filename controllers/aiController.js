const ollamaService = require('../services/ollamaService');

function getTranscript(req) {
  return req.body && typeof req.body.transcript === 'string'
    ? req.body.transcript.trim()
    : '';
}

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
    missing_information: 'AI report generation was unavailable. Officer should confirm incident type, location, date/time, hazards, injuries, and other scene details.',
    officer_notes: 'Fallback draft created locally. Review and edit before saving.'
  };
}

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
      error: `Transcript cleanup failed: ${error.message}`,
      cleanedTranscript: transcript
    });
  }
};

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
      error: `AI report generation failed: ${error.message}`,
      report: fallbackReport(transcript)
    });
  }
};

exports.getOllamaStatus = async (req, res) => {
  const health = await ollamaService.checkHealth();

  res.json({
    success: health.available,
    available: health.available,
    ollama: ollamaService.getConfig()
  });
};
