const express = require('express');
const aiController = require('../controllers/aiController');

const router = express.Router();

router.get('/api/ai/status', aiController.getOllamaStatus);
router.post('/api/ai/clean-transcript', aiController.cleanTranscript);
router.post('/api/reports/generate', aiController.generateReport);

module.exports = router;
