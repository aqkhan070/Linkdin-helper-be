const express = require('express');
const router = express.Router();
const linkedinController = require('../controllers/linkedin.controller');
const authMiddleware = require('../middleware/auth.middleware');

// Public config route (returns configured Client ID if set)
router.get('/config', linkedinController.getConfig);

// Protected routes (require user login)
router.use(authMiddleware);

router.post('/exchange', linkedinController.exchangeToken);
router.get('/accounts', linkedinController.getAccounts);
router.post('/accounts', linkedinController.createAccount);
router.patch('/accounts/:id/star', linkedinController.toggleStar);
router.patch('/accounts/:id/status', linkedinController.updateStatus);
router.delete('/accounts/:id', linkedinController.deleteAccount);

module.exports = router;
