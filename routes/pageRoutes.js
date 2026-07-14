const express = require('express');
const pageController = require('../controllers/pageController');

const router = express.Router();

router.get('/', pageController.showDashboard);
router.get('/dashboard', pageController.showDashboard);
router.get('/analytics', pageController.showAnalytics);
router.get('/dev/map-payload', pageController.showDevMapPayload);
// Done by: Khin (25036933)
// Register the live transcription page and its supporting health endpoints.
router.get('/transcription', pageController.showTranscription);
router.get('/transcription/health', pageController.checkTranscriptionHealth);
router.get('/system/status', pageController.checkSystemStatus);
router.get('/team-members', pageController.showTeamMembers);
router.get('/settings', pageController.showSettings);
router.get('/api-keys', pageController.showApiKeys);

module.exports = router;
