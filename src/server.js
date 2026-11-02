/**
 * LinkedIn Helper Backend - Entry Point
 * Node.js + Express + PostgreSQL
 */
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

// Import routes
const authRoutes = require('./routes/auth.routes');
const linkedinRoutes = require('./routes/linkedin.routes');
const postRoutes = require('./routes/post.routes');
const { startPostScheduler } = require('./services/postScheduler.service');

const app = express();
const PORT = process.env.PORT || 5000;

// ─── Security Middleware ─────────────────────────────────
app.use(helmet());

// ─── CORS ────────────────────────────────────────────────
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// ─── Body Parsing ────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Request Logging ─────────────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// ─── Health Check ────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'LinkedIn Helper Backend is running!',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
});

// ─── API Routes ──────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/linkedin', linkedinRoutes);
app.use('/api/posts', postRoutes);

// ─── 404 Handler ─────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`,
  });
});

// ─── Global Error Handler ────────────────────────────────
app.use((err, req, res, next) => {
  console.error('❌ Unhandled Error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

// ─── Start Server ────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 LinkedIn Helper Backend`);
  console.log(`   ├─ Port:        ${PORT}`);
  console.log(`   ├─ Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   ├─ Health:      http://localhost:${PORT}/api/health`);
  console.log(`   ├─ Auth API:    http://localhost:${PORT}/api/auth`);
  console.log(`   └─ Posts API:   http://localhost:${PORT}/api/posts\n`);

  // Start background post scheduler
  startPostScheduler(20000);
});

module.exports = app;
