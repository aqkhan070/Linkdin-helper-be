/**
 * Auth Routes
 * /api/auth/*
 */
const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const authMiddleware = require('../middleware/auth.middleware');
const {
  registerValidation,
  loginValidation,
  validate,
} = require('../middleware/validation.middleware');

// ─── Public Routes ───────────────────────────────────────
router.post('/register', registerValidation, validate, authController.register);
router.post('/login', loginValidation, validate, authController.login);
router.post('/refresh', authController.refreshToken);

// ─── Protected Routes (require JWT) ─────────────────────
router.post('/logout', authMiddleware, authController.logout);
router.get('/me', authMiddleware, authController.getProfile);
router.put('/profile', authMiddleware, authController.updateProfile);
router.put('/change-password', authMiddleware, authController.changePassword);

module.exports = router;
