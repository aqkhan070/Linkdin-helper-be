/**
 * Post Scheduler & Automated Publisher Service
 * Periodically scans for due scheduled posts and publishes them to LinkedIn.
 */
const { pool } = require('../config/database');

let schedulerTimer = null;

/**
 * Publishes a single post by ID.
 * Can be called automatically by the scheduler or on-demand via "Publish Now".
 */
async function publishSinglePost(postId, userId) {
  const query = `
    SELECT 
      p.*,
      a.access_token,
      a.linkedin_member_urn,
      a.name AS account_name,
      a.email AS account_email
    FROM scheduled_posts p
    LEFT JOIN linkedin_accounts a ON p.account_id = a.id
    WHERE p.id = $1 AND p.user_id = $2
  `;

  const { rows } = await pool.query(query, [postId, userId]);
  if (!rows || rows.length === 0) {
    throw new Error('Post not found');
  }

  const post = rows[0];

  // Mark status as 'publishing'
  await pool.query(
    `UPDATE scheduled_posts SET status = 'publishing', updated_at = NOW() WHERE id = $1`,
    [postId]
  );

  try {
    let postUrn = null;

    // Check if account has official OAuth token and member URN
    if (
      post.access_token &&
      post.linkedin_member_urn &&
      !post.access_token.startsWith('demo_')
    ) {
      // Official LinkedIn REST Posts API
      const linkedinPayload = {
        author: post.linkedin_member_urn,
        commentary: post.content,
        visibility: 'PUBLIC',
        distribution: {
          feedDistribution: 'MAIN_FEED',
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
      };

      const response = await fetch('https://api.linkedin.com/rest/posts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${post.access_token}`,
          'X-Restli-Protocol-Version': '2.0.0',
          'LinkedIn-Version': '202401',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(linkedinPayload),
      });

      if (response.status === 201) {
        postUrn =
          response.headers.get('x-restli-id') ||
          `urn:li:share:${Date.now()}`;
      } else {
        const errorText = await response.text();
        throw new Error(
          `LinkedIn API Error (${response.status}): ${errorText}`
        );
      }
    } else {
      // Fail closed: never invent a URN or mark Published without OAuth.
      throw new Error(
        'LinkedIn OAuth required for Publish Now. Connect an authorized LinkedIn account (access token + member URN). Session/desktop accounts cannot be published via API.'
      );
    }

    // Success! Update status to 'published'
    const updateQuery = `
      UPDATE scheduled_posts
      SET 
        status = 'published',
        published_at = NOW(),
        post_urn = $1,
        error_message = NULL,
        updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `;
    const res = await pool.query(updateQuery, [postUrn, postId]);
    return res.rows[0];
  } catch (error) {
    console.error(`❌ Failed to publish post [${postId}]:`, error.message);
    const failQuery = `
      UPDATE scheduled_posts
      SET 
        status = 'failed',
        error_message = $1,
        updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `;
    await pool.query(failQuery, [error.message, postId]);
    throw error;
  }
}

/**
 * Checks for scheduled posts that are due (scheduled_at <= NOW()).
 */
async function processDueScheduledPosts() {
  try {
    // Only pick up posts that have an official LinkedIn REST API token configured.
    // Desktop session posts must be published through the desktop browser instance.
    const dueQuery = `
      SELECT p.id, p.user_id, p.content, p.scheduled_at 
      FROM scheduled_posts p
      JOIN linkedin_accounts a ON p.account_id = a.id
      WHERE p.status = 'scheduled' 
        AND p.scheduled_at <= NOW()
        AND a.access_token IS NOT NULL 
        AND a.access_token NOT LIKE 'demo_%'
      ORDER BY p.scheduled_at ASC
      LIMIT 10
    `;
    const { rows } = await pool.query(dueQuery);

    if (rows && rows.length > 0) {
      console.log(`[Scheduler] ⏰ Found ${rows.length} due post(s) to publish...`);
      for (const duePost of rows) {
        console.log(`[Scheduler] Publishing post ID: ${duePost.id}`);
        try {
          await publishSinglePost(duePost.id, duePost.user_id);
          console.log(`[Scheduler] ✅ Successfully published post ${duePost.id}`);
        } catch (err) {
          console.error(`[Scheduler] ⚠️ Post ${duePost.id} failed:`, err.message);
        }
      }
    }
  } catch (err) {
    console.error('[Scheduler] Error checking due posts:', err.message);
  }
}

/**
 * Starts the recurring scheduler worker.
 * Scans every 20 seconds.
 */
function startPostScheduler(intervalMs = 20000) {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
  }
  console.log(`[Scheduler] 🚀 LinkedIn Post Scheduler started (Interval: ${intervalMs / 1000}s)`);
  
  // Run once immediately on startup
  processDueScheduledPosts();

  // Then recurring
  schedulerTimer = setInterval(processDueScheduledPosts, intervalMs);
}

function stopPostScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
    console.log('[Scheduler] 🛑 LinkedIn Post Scheduler stopped');
  }
}

module.exports = {
  publishSinglePost,
  processDueScheduledPosts,
  startPostScheduler,
  stopPostScheduler,
};
