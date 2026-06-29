const express = require('express');
const incidentController = require('../controllers/incidentController');

const router = express.Router();

router.get('/api/incidents', incidentController.getIncidentsApi);
router.get('/create-report', incidentController.showCreateReport);
router.post('/incidents', incidentController.createIncident);
router.get('/incidents', incidentController.showIncidents);
router.get('/incidents/:incidentId/edit', incidentController.showEditReport);
router.post('/incidents/:incidentId', incidentController.updateIncident);
router.post('/incidents/:incidentId/delete', incidentController.deleteIncident);
router.get('/incidents/:incidentId', incidentController.showReportDetails);

module.exports = router;
