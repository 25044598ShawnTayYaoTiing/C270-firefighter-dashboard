const express = require('express');
const aiController = require('../controllers/aiController');

const router = express.Router();

// Done BY SHAWN ID 25044598
// AI Features: API routes for Ollama health, transcript cleanup, and AI incident draft generation.
router.get('/api/ai/status', aiController.getOllamaStatus);
router.post('/api/ai/clean-transcript', aiController.cleanTranscript);
router.post('/api/reports/generate', aiController.generateReport);

module.exports = router;
