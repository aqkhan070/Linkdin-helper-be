require('dotenv').config();
const { pool } = require('../config/database');

async function reset() {
  const res = await pool.query("UPDATE scheduled_posts SET status = 'scheduled', published_at = NULL WHERE status = 'published';");
  console.log(`Successfully reset ${res.rowCount} posts back to 'scheduled'.`);
  await pool.end();
}

reset().catch(console.error);
