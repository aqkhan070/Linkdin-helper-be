const { pool } = require('../config/database');

/**
 * Get LinkedIn OAuth configuration (Client ID, Redirect URI)
 */
exports.getConfig = async (req, res) => {
  res.json({
    success: true,
    data: {
      clientId: process.env.LINKEDIN_CLIENT_ID || '',
      redirectUri: process.env.LINKEDIN_REDIRECT_URI || 'http://127.0.0.1:48291/callback',
      hasClientSecret: Boolean(process.env.LINKEDIN_CLIENT_SECRET),
    },
  });
};

/**
 * Exchange OAuth 2.0 authorization code for access token & user profile
 */
exports.exchangeToken = async (req, res) => {
  try {
    const { code, codeVerifier, redirectUri, clientId, clientSecret } = req.body;

    if (!code) {
      return res.status(400).json({
        success: false,
        message: 'Authorization code is required.',
      });
    }

    const resolvedClientId = clientId || process.env.LINKEDIN_CLIENT_ID;
    const resolvedClientSecret = clientSecret || process.env.LINKEDIN_CLIENT_SECRET;
    const resolvedRedirectUri = redirectUri || process.env.LINKEDIN_REDIRECT_URI || 'http://127.0.0.1:48291/callback';

    if (!resolvedClientId) {
      return res.status(400).json({
        success: false,
        message: 'LinkedIn Client ID is missing. Please configure it in settings or .env.',
      });
    }

    // Prepare token request
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: resolvedRedirectUri,
      client_id: resolvedClientId,
    });

    if (resolvedClientSecret) {
      tokenParams.append('client_secret', resolvedClientSecret);
    }
    if (codeVerifier) {
      tokenParams.append('code_verifier', codeVerifier);
    }

    // 1. Exchange code for access token with LinkedIn
    const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: tokenParams.toString(),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.access_token) {
      return res.status(400).json({
        success: false,
        message: tokenData.error_description || tokenData.error || 'Failed to exchange authorization code with LinkedIn.',
        error: tokenData,
      });
    }

    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token || null;
    const expiresIn = tokenData.expires_in || 5184000; // 60 days
    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);
    const scope = tokenData.scope || 'openid profile email w_member_social';

    // 2. Fetch authenticated LinkedIn profile via OpenID userinfo
    const profileResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    let profile = {};
    if (profileResponse.ok) {
      profile = await profileResponse.json();
    }

    const memberUrn = profile.sub
      ? (profile.sub.startsWith('urn:') ? profile.sub : `urn:li:person:${profile.sub}`)
      : `urn:li:person:${Date.now()}`;
    const name = profile.name || [profile.given_name, profile.family_name].filter(Boolean).join(' ') || 'LinkedIn Member';
    const email = profile.email || req.user.email;
    const avatarUrl = profile.picture || null;
    const firstName = profile.given_name || null;
    const lastName = profile.family_name || null;

    // 3. Upsert into PostgreSQL database
    const query = `
      INSERT INTO linkedin_accounts (
        user_id, linkedin_member_urn, name, first_name, last_name,
        email, avatar_url, access_token, refresh_token, token_expires_at,
        scope, status
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'running'
      )
      ON CONFLICT (user_id, email)
      DO UPDATE SET
        name = EXCLUDED.name,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        email = EXCLUDED.email,
        avatar_url = COALESCE(EXCLUDED.avatar_url, linkedin_accounts.avatar_url),
        access_token = EXCLUDED.access_token,
        refresh_token = COALESCE(EXCLUDED.refresh_token, linkedin_accounts.refresh_token),
        token_expires_at = EXCLUDED.token_expires_at,
        scope = EXCLUDED.scope,
        status = 'running',
        updated_at = NOW()
      RETURNING *;
    `;

    const values = [
      req.user.id,
      memberUrn,
      name,
      firstName,
      lastName,
      email,
      avatarUrl,
      accessToken,
      refreshToken,
      tokenExpiresAt,
      scope,
    ];

    const result = await pool.query(query, values);
    const account = result.rows[0];

    res.status(200).json({
      success: true,
      message: 'LinkedIn account connected successfully via OAuth 2.0!',
      data: {
        account: {
          id: account.id,
          memberUrn: account.linkedin_member_urn,
          name: account.name,
          firstName: account.first_name,
          lastName: account.last_name,
          email: account.email,
          avatarUrl: account.avatar_url,
          headline: account.headline,
          timeZone: account.time_zone,
          isStarred: account.is_starred,
          status: account.status,
          createdAt: account.created_at,
        },
      },
    });
  } catch (error) {
    console.error('LinkedIn OAuth exchange error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error during LinkedIn OAuth token exchange.',
    });
  }
};

/**
 * Add / register a LinkedIn account by email (ready to login via browser)
 */
exports.createAccount = async (req, res) => {
  try {
    const { email, name, timeZone } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'LinkedIn account email is required.',
      });
    }

    const accountName = name || email.split('@')[0] || 'LinkedIn Member';
    const tz = timeZone || '(GMT+05:00) Islamabad, Karachi';

    const query = `
      INSERT INTO linkedin_accounts (
        user_id, email, name, time_zone, status, is_starred
      ) VALUES (
        $1, $2, $3, $4, 'running', false
      )
      ON CONFLICT (user_id, email)
      DO UPDATE SET
        name = COALESCE(EXCLUDED.name, linkedin_accounts.name),
        time_zone = EXCLUDED.time_zone,
        status = 'running',
        updated_at = NOW()
      RETURNING *;
    `;

    const result = await pool.query(query, [
      req.user.id,
      email.toLowerCase().trim(),
      accountName,
      tz,
    ]);
    const account = result.rows[0];

    res.status(200).json({
      success: true,
      message: 'LinkedIn account added successfully!',
      data: {
        account: {
          id: account.id,
          memberUrn: account.linkedin_member_urn || '',
          name: account.name,
          firstName: account.first_name,
          lastName: account.last_name,
          email: account.email,
          avatarUrl: account.avatar_url,
          headline: account.headline,
          timeZone: account.time_zone,
          isStarred: account.is_starred,
          status: account.status,
          createdAt: account.created_at,
        },
      },
    });
  } catch (error) {
    console.error('Create LinkedIn account error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error while creating LinkedIn account.',
    });
  }
};

/**
 * List all connected LinkedIn accounts for current user
 */
exports.getAccounts = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, linkedin_member_urn, name, first_name, last_name, email,
              avatar_url, headline, time_zone, is_starred, status, created_at, updated_at
       FROM linkedin_accounts
       WHERE user_id = $1
       ORDER BY is_starred DESC, created_at DESC`,
      [req.user.id]
    );

    const accounts = result.rows.map((row) => ({
      id: row.id,
      memberUrn: row.linkedin_member_urn,
      name: row.name,
      firstName: row.first_name,
      lastName: row.last_name,
      email: row.email,
      avatarUrl: row.avatar_url,
      headline: row.headline,
      timeZone: row.time_zone,
      isStarred: row.is_starred,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    res.json({
      success: true,
      data: { accounts },
    });
  } catch (error) {
    console.error('Get LinkedIn accounts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve LinkedIn accounts.',
    });
  }
};

/**
 * Toggle star on LinkedIn account
 */
exports.toggleStar = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE linkedin_accounts
       SET is_starred = NOT is_starred, updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING id, is_starred`,
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'LinkedIn account not found.',
      });
    }

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Toggle star error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to toggle star status.',
    });
  }
};

/**
 * Update account status (running, stopped, in_use, archived)
 */
exports.updateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['running', 'stopped', 'in_use', 'archived'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
      });
    }

    const result = await pool.query(
      `UPDATE linkedin_accounts
       SET status = $1, updated_at = NOW()
       WHERE id = $2 AND user_id = $3
       RETURNING id, status`,
      [status, id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'LinkedIn account not found.',
      });
    }

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update account status.',
    });
  }
};

/**
 * Delete / disconnect LinkedIn account
 */
exports.deleteAccount = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `DELETE FROM linkedin_accounts
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'LinkedIn account not found.',
      });
    }

    res.json({
      success: true,
      message: 'LinkedIn account disconnected successfully.',
      data: { id },
    });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete LinkedIn account.',
    });
  }
};
