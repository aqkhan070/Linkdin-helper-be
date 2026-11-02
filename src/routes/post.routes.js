const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth.middleware');
const {
  getPosts,
  getPostStats,
  createPost,
  getPostById,
  updatePost,
  deletePost,
  publishPostNow,
} = require('../controllers/post.controller');

// All routes are protected
router.use(authMiddleware);

// Post Stats
router.get('/stats', getPostStats);

// List & Create Posts
router.get('/', getPosts);
router.post('/', createPost);

// Single Post Operations
router.get('/:id', getPostById);
router.put('/:id', updatePost);
router.delete('/:id', deletePost);

// Immediate publish trigger
router.post('/:id/publish-now', publishPostNow);

module.exports = router;
