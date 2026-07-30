const express = require('express');
const transcriptionController = require('../controllers/transcriptionController');

const router = express.Router();

router.post('/api/transcribe/stream-token', transcriptionController.createStreamToken);
router.post('/api/transcribe', transcriptionController.transcribe);

module.exports = router;
