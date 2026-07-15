// done by Thein 25040396
// AI Features: authRoutes.js handles authentication routes for login and logout, ensuring proper access control for users.
const express = require('express');
const authController = require('../controllers/authController');
const {
  redirectIfAuthenticated,
  requireAuth
} = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/login', redirectIfAuthenticated, authController.showLogin);
router.post('/login', redirectIfAuthenticated, authController.login);
router.post('/logout', requireAuth, authController.logout);
router.get('/logout', requireAuth, authController.logout);

module.exports = router;
