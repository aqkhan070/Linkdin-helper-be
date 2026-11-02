# LinkedIn Helper Backend — API Reference

> **Base URL:** `http://localhost:5000`  
> **Database:** `postgresql://postgres:2244@localhost:5432/linkedin_helper_backend`

---

## Quick Setup

```bash
# 1. Install dependencies
npm install

# 2. Run database migration (creates users + refresh_tokens tables)
npm run migrate

# 3. Start dev server
npm run dev
```

---

## 🟢 Health Check

### `GET /api/health`

No auth required.

**Response `200`**
```json
{
  "success": true,
  "message": "LinkedIn Helper Backend is running!",
  "timestamp": "2026-10-22T05:30:00.000Z",
  "environment": "development"
}
```

---

## 🔓 Public Auth Routes

### `POST /api/auth/register` — Sign Up

Create a new user account and receive JWT tokens.

**Headers**
| Key | Value |
|---|---|
| Content-Type | application/json |

**Body**
```json
{
  "fullName": "Ahtsham Shakoor",
  "email": "ahtsham@example.com",
  "password": "Test1234"
}
```

**Validation Rules**
| Field | Rules |
|---|---|
| `fullName` | Required, 2–100 characters |
| `email` | Required, valid email format |
| `password` | Required, min 6 chars, must contain at least one number |

**Response `201 Created`**
```json
{
  "success": true,
  "message": "Account created successfully!",
  "data": {
    "user": {
      "id": "uuid",
      "fullName": "Ahtsham Shakoor",
      "email": "ahtsham@example.com",
      "isActive": true,
      "isVerified": false,
      "createdAt": "2026-10-22T05:30:00.000Z"
    },
    "tokens": {
      "accessToken": "eyJhbGciOi...",
      "refreshToken": "eyJhbGciOi...",
      "expiresIn": "1h"
    }
  }
}
```

**Error Responses**
| Code | Message |
|---|---|
| `400` | Validation failed (with field-level errors) |
| `409` | An account with this email already exists |

---

### `POST /api/auth/login` — Login

Authenticate with email & password.

**Headers**
| Key | Value |
|---|---|
| Content-Type | application/json |

**Body**
```json
{
  "email": "ahtsham@example.com",
  "password": "Test1234"
}
```

**Response `200 OK`**
```json
{
  "success": true,
  "message": "Login successful!",
  "data": {
    "user": {
      "id": "uuid",
      "fullName": "Ahtsham Shakoor",
      "email": "ahtsham@example.com",
      "avatarUrl": null,
      "isActive": true,
      "isVerified": false,
      "lastLoginAt": "2026-10-22T05:30:00.000Z"
    },
    "tokens": {
      "accessToken": "eyJhbGciOi...",
      "refreshToken": "eyJhbGciOi...",
      "expiresIn": "1h"
    }
  }
}
```

**Error Responses**
| Code | Message |
|---|---|
| `400` | Validation failed |
| `401` | Invalid email or password |
| `403` | Account deactivated |

---

### `POST /api/auth/refresh` — Refresh Token

Get a new access token using a valid refresh token. Uses **token rotation** — the old refresh token is revoked.

**Headers**
| Key | Value |
|---|---|
| Content-Type | application/json |

**Body**
```json
{
  "refreshToken": "<your-refresh-token>"
}
```

**Response `200 OK`**
```json
{
  "success": true,
  "message": "Token refreshed successfully.",
  "data": {
    "tokens": {
      "accessToken": "eyJhbGciOi...",
      "refreshToken": "eyJhbGciOi...",
      "expiresIn": "1h"
    }
  }
}
```

**Error Responses**
| Code | Message |
|---|---|
| `400` | Refresh token is required |
| `401` | Invalid or expired refresh token |

---

## 🔒 Protected Routes (Require Bearer Token)

All protected routes require the `Authorization` header:
```
Authorization: Bearer <your-access-token>
```

### `GET /api/auth/me` — Get My Profile

**Response `200 OK`**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "fullName": "Ahtsham Shakoor",
      "email": "ahtsham@example.com",
      "avatarUrl": null,
      "isActive": true,
      "isVerified": false,
      "lastLoginAt": "2026-10-22T05:30:00.000Z",
      "createdAt": "2026-10-22T05:00:00.000Z",
      "updatedAt": "2026-10-22T05:30:00.000Z"
    }
  }
}
```

---

### `PUT /api/auth/profile` — Update Profile

Both fields are optional — only provided fields are updated.

**Body**
```json
{
  "fullName": "Ahtsham Shakoor Updated",
  "avatarUrl": "https://example.com/avatar.jpg"
}
```

**Response `200 OK`**
```json
{
  "success": true,
  "message": "Profile updated successfully.",
  "data": { "user": { "..." } }
}
```

---

### `PUT /api/auth/change-password` — Change Password

All refresh tokens are revoked after password change (forces re-login on all devices).

**Body**
```json
{
  "currentPassword": "Test1234",
  "newPassword": "NewSecure1234"
}
```

**Response `200 OK`**
```json
{
  "success": true,
  "message": "Password changed successfully. Please login again."
}
```

**Error Responses**
| Code | Message |
|---|---|
| `400` | Current password and new password are required / Min 6 chars |
| `401` | Current password is incorrect |

---

### `POST /api/auth/logout` — Logout

Revokes all refresh tokens for the current user.

**Response `200 OK`**
```json
{
  "success": true,
  "message": "Logged out successfully. All sessions revoked."
}
```

---

## 🗄️ Database Schema

### `users` Table
| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key, auto-generated |
| full_name | VARCHAR(100) | Required |
| email | VARCHAR(255) | Unique, required |
| password_hash | VARCHAR(255) | bcrypt, 12 salt rounds |
| avatar_url | VARCHAR(500) | Optional |
| is_active | BOOLEAN | Default: true |
| is_verified | BOOLEAN | Default: false |
| last_login_at | TIMESTAMPTZ | Updated on each login |
| created_at | TIMESTAMPTZ | Auto |
| updated_at | TIMESTAMPTZ | Auto (via trigger) |

### `refresh_tokens` Table
| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| user_id | UUID | FK → users(id), CASCADE delete |
| token | VARCHAR(500) | Unique |
| expires_at | TIMESTAMPTZ | 7 days from creation |
| is_revoked | BOOLEAN | Default: false |
| created_at | TIMESTAMPTZ | Auto |

---

## 📢 Scheduled Posts & Automated Publisher Routes

All routes require `Authorization: Bearer <accessToken>`.

### `GET /api/posts/stats` — Posts Overview Statistics
Returns total, scheduled, published, draft, and failed counts.

**Response `200 OK`**
```json
{
  "success": true,
  "data": {
    "total": 5,
    "scheduled": 2,
    "published": 2,
    "failed": 0,
    "draft": 1
  }
}
```

---

### `GET /api/posts` — List Scheduled Posts
Supports filter query param `?status=scheduled` (`all`, `scheduled`, `published`, `draft`, `failed`).

**Response `200 OK`**
```json
{
  "success": true,
  "count": 2,
  "data": [
    {
      "id": "uuid",
      "content": "My scheduled LinkedIn post content",
      "scheduled_at": "2026-10-23T09:00:00.000Z",
      "status": "scheduled",
      "account_name": "Ahtsham Shakoor"
    }
  ]
}
```

---

### `POST /api/posts` — Create / Schedule Post
Schedule a post for a future time or publish immediately (`publish_now: true`).

**Request Body**
```json
{
  "account_id": "optional-account-uuid",
  "content": "Excited to share our new Flutter desktop release! #Flutter #Dev",
  "scheduled_at": "2026-10-23T14:30:00Z",
  "media_url": "https://example.com/article",
  "tags": "#Flutter #Dart",
  "publish_now": false,
  "is_draft": false
}
```

---

### `POST /api/posts/:id/publish-now` — Force Immediate Publication
Immediately triggers publication of a scheduled or failed post.

---

### `DELETE /api/posts/:id` — Delete Post
Cancels and deletes a scheduled post from the database.

---

### `scheduled_posts` Table
| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| user_id | UUID | FK → users(id), CASCADE delete |
| account_id | UUID | FK → linkedin_accounts(id), SET NULL |
| content | TEXT | Required commentary |
| media_url | VARCHAR(1000) | Optional link / media |
| tags | VARCHAR(500) | Hashtags |
| scheduled_at | TIMESTAMPTZ | Scheduled execution timestamp |
| published_at | TIMESTAMPTZ | Timestamp when published |
| status | VARCHAR(50) | 'draft', 'scheduled', 'publishing', 'published', 'failed' |
| post_urn | VARCHAR(255) | LinkedIn share URN |
| error_message | TEXT | Reason if failed |
| created_at | TIMESTAMPTZ | Auto |
| updated_at | TIMESTAMPTZ | Auto (via trigger) |
