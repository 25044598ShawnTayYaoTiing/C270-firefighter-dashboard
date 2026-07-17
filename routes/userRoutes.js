const express = require('express');
const userController = require('../controllers/userController');
const { requirePermission } = require('../middleware/authMiddleware');
const { PERMISSIONS } = require('../middleware/rolePermissions');

const router = express.Router();
const requireUserManagement = requirePermission(PERMISSIONS.MANAGE_USERS);

router.get('/users', requireUserManagement, userController.showUsers);
router.get('/users/new', requireUserManagement, userController.showAddUser);
router.post('/users', requireUserManagement, userController.createUser);
router.get('/users/:userId/edit', requireUserManagement, userController.showEditUser);
router.post('/users/:userId', requireUserManagement, userController.updateUser);
router.post('/users/:userId/deactivate', requireUserManagement, userController.deactivateUser);

module.exports = router;
