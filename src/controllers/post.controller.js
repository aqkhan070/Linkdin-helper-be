/**
 * Post Publisher Controller
 * Manages scheduled posts, drafts, and immediate LinkedIn publications.
 */
const { pool } = require('../config/database');
const { publishSinglePost } = require('../services/postScheduler.service');

/**
 * GET /api/posts
 * Fetch all posts for the authenticated user with optional status filter.
 */
async function getPosts(req, res) {
  try {
    const userId = req.user.id;
    const { status } = req.query;

    let query = `
      SELECT 
        p.*,
        a.name AS account_name,
        a.email AS account_email,
        a.avatar_url AS account_avatar
      FROM scheduled_posts p
      LEFT JOIN linkedin_accounts a ON p.account_id = a.id
      WHERE p.user_id = $1
    `;
    const params = [userId];

    if (status && status !== 'all') {
      params.push(status);
      query += ` AND p.status = $${params.length}`;
    }

    query += ` ORDER BY p.scheduled_at DESC, p.created_at DESC`;

    const { rows } = await pool.query(query, params);

    res.status(200).json({
      success: true,
      count: rows.length,
      data: rows,
    });
  } catch (error) {
    console.error('getPosts error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve posts', error: error.message });
  }
}

/**
 * GET /api/posts/stats
 * Get overview counters of posts.
 */
async function getPostStats(req, res) {
  try {
    const userId = req.user.id;
    const query = `
      SELECT
        COUNT(*) AS total,
        COUNT(CASE WHEN status = 'scheduled' THEN 1 END) AS scheduled,
        COUNT(CASE WHEN status = 'published' THEN 1 END) AS published,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) AS failed,
        COUNT(CASE WHEN status = 'draft' THEN 1 END) AS draft
      FROM scheduled_posts
      WHERE user_id = $1
    `;
    const { rows } = await pool.query(query, [userId]);
    const stats = rows[0] || { total: 0, scheduled: 0, published: 0, failed: 0, draft: 0 };

    res.status(200).json({
      success: true,
      data: {
        total: parseInt(stats.total, 10) || 0,
        scheduled: parseInt(stats.scheduled, 10) || 0,
        published: parseInt(stats.published, 10) || 0,
        failed: parseInt(stats.failed, 10) || 0,
        draft: parseInt(stats.draft, 10) || 0,
      },
    });
  } catch (error) {
    console.error('getPostStats error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve stats', error: error.message });
  }
}

/**
 * POST /api/posts
 * Create & schedule a new LinkedIn post.
 */
async function createPost(req, res) {
  try {
    const userId = req.user.id;
    const {
      account_id,
      content,
      media_url,
      tags,
      scheduled_at,
      publish_now = false,
      is_draft = false,
    } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Post content cannot be empty',
      });
    }

    let targetDate;
    let initialStatus = 'scheduled';

    if (is_draft) {
      initialStatus = 'draft';
      targetDate = scheduled_at ? new Date(scheduled_at) : new Date();
    } else if (publish_now) {
      initialStatus = 'scheduled';
      targetDate = new Date(); // Right now
    } else {
      if (!scheduled_at) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a scheduled date and time',
        });
      }
      targetDate = new Date(scheduled_at);
      if (isNaN(targetDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid scheduled_at date format',
        });
      }
    }

    const insertQuery = `
      INSERT INTO scheduled_posts (
        user_id,
        account_id,
        content,
        media_url,
        tags,
        scheduled_at,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;

    const { rows } = await pool.query(insertQuery, [
      userId,
      account_id || null,
      content.trim(),
      media_url || null,
      tags || null,
      targetDate,
      initialStatus,
    ]);

    let createdPost = rows[0];

    // If publish_now requested, immediately trigger publishing
    if (publish_now) {
      try {
        createdPost = await publishSinglePost(createdPost.id, userId);
      } catch (publishErr) {
        // Reload post so client sees failed/scheduled status — never claim publish success
        const { rows: refreshed } = await pool.query(
          `SELECT * FROM scheduled_posts WHERE id = $1 AND user_id = $2`,
          [createdPost.id, userId]
        );
        const failedPost = refreshed[0] || createdPost;
        return res.status(422).json({
          success: false,
          message:
            'Post saved but LinkedIn publication failed: ' + publishErr.message,
          data: failedPost,
        });
      }

      if (!createdPost || createdPost.status !== 'published') {
        return res.status(422).json({
          success: false,
          message: 'Post was not confirmed as published by LinkedIn',
          data: createdPost,
        });
      }
    }

    res.status(201).json({
      success: true,
      message: publish_now
        ? 'Post published to LinkedIn!'
        : is_draft
          ? 'Draft saved successfully!'
          : 'Post scheduled successfully!',
      data: createdPost,
    });
  } catch (error) {
    console.error('createPost error:', error);
    res.status(500).json({ success: false, message: 'Failed to create post', error: error.message });
  }
}

/**
 * GET /api/posts/:id
 * Retrieve a specific post.
 */
async function getPostById(req, res) {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const query = `
      SELECT 
        p.*,
        a.name AS account_name,
        a.email AS account_email,
        a.avatar_url AS account_avatar
      FROM scheduled_posts p
      LEFT JOIN linkedin_accounts a ON p.account_id = a.id
      WHERE p.id = $1 AND p.user_id = $2
    `;
    const { rows } = await pool.query(query, [id, userId]);

    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    res.status(200).json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('getPostById error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve post', error: error.message });
  }
}

/**
 * PUT /api/posts/:id
 * Update an existing post (if not yet published).
 */
async function updatePost(req, res) {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { content, scheduled_at, account_id, media_url, tags, status } = req.body;

    const checkQuery = `SELECT * FROM scheduled_posts WHERE id = $1 AND user_id = $2`;
    const { rows: existing } = await pool.query(checkQuery, [id, userId]);

    if (!existing.length) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    const post = existing[0];
    if (post.status === 'published') {
      return res.status(400).json({ success: false, message: 'Cannot edit an already published post' });
    }

    const updateQuery = `
      UPDATE scheduled_posts
      SET
        content = COALESCE($1, content),
        scheduled_at = COALESCE($2, scheduled_at),
        account_id = COALESCE($3, account_id),
        media_url = COALESCE($4, media_url),
        tags = COALESCE($5, tags),
        status = COALESCE($6, status),
        updated_at = NOW()
      WHERE id = $7 AND user_id = $8
      RETURNING *
    `;

    const { rows } = await pool.query(updateQuery, [
      content ? content.trim() : null,
      scheduled_at ? new Date(scheduled_at) : null,
      account_id || null,
      media_url || null,
      tags || null,
      status || null,
      id,
      userId,
    ]);

    res.status(200).json({
      success: true,
      message: 'Post updated successfully',
      data: rows[0],
    });
  } catch (error) {
    console.error('updatePost error:', error);
    res.status(500).json({ success: false, message: 'Failed to update post', error: error.message });
  }
}

/**
 * DELETE /api/posts/:id
 * Remove a post from schedule/database.
 */
async function deletePost(req, res) {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const query = `DELETE FROM scheduled_posts WHERE id = $1 AND user_id = $2 RETURNING id`;
    const { rows } = await pool.query(query, [id, userId]);

    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    res.status(200).json({
      success: true,
      message: 'Post deleted successfully',
      data: { id: rows[0].id },
    });
  } catch (error) {
    console.error('deletePost error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete post', error: error.message });
  }
}

/**
 * POST /api/posts/:id/publish-now
 * Force immediate publication of a post.
 */
async function publishPostNow(req, res) {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const published = await publishSinglePost(id, userId);

    res.status(200).json({
      success: true,
      message: 'Post published successfully!',
      data: published,
    });
  } catch (error) {
    console.error('publishPostNow error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to publish post',
    });
  }
}

module.exports = {
  getPosts,
  getPostStats,
  createPost,
  getPostById,
  updatePost,
  deletePost,
  publishPostNow,
};
