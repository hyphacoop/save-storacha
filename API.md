# API Documentation

This document provides detailed API endpoint documentation for the save_storacha service.

## Base URL

All endpoints are relative to `http://localhost:3000` (or your configured server URL).

## Authentication

### POST /auth/login
Unified login endpoint (email + DID required).

**Request:**
```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{
    "email": "your-email@example.com",
    "did": "did:key:your-did-here"
  }' \
  http://localhost:3000/auth/login
```

**Response:**
```json
{
  "message": "Login successful",
  "sessionId": "your-session-id",
  "did": "did:key:your-did-here"
}
```

### POST /auth/login/did
Admin login with DID only (for subsequent logins).

**Request:**
```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{
    "did": "did:key:your-did-here"
  }' \
  http://localhost:3000/auth/login/did
```

**Response:**
```json
{
  "message": "Login successful",
  "sessionId": "your-session-id",
  "did": "did:key:your-did-here"
}
```

### POST /auth/login/email
Initiates w3up email validation (deprecated, use `/login` instead).

**Request:**
```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{
    "email": "your-email@example.com",
    "did": "did:key:your-did-here"
  }' \
  http://localhost:3000/auth/login/email
```

### GET /auth/session
Validate session.

**Request:**
```bash
curl -H "x-session-id: your-session-id" \
  http://localhost:3000/auth/session
```

**Response:**
```json
{
  "valid": true,
  "expiresAt": "2024-03-21T12:00:00.000Z",
  "message": "Session is valid"
}
```

### POST /auth/logout
Clear session.

**Request:**
```bash
curl -X POST -H "x-session-id: your-session-id" \
  http://localhost:3000/auth/logout
```

### POST /auth/w3up/logout
Logout from w3up service.

**Request:**
```bash
curl -X POST -H "x-session-id: your-session-id" \
  http://localhost:3000/auth/w3up/logout
```

### GET /auth/sessions
List all sessions for the authenticated user.

**Request:**
```bash
curl -H "x-session-id: your-session-id" \
  http://localhost:3000/auth/sessions
```

### POST /auth/sessions/:sessionId/deactivate
Deactivate a specific session.

**Request:**
```bash
curl -X POST -H "x-session-id: your-session-id" \
  http://localhost:3000/auth/sessions/your-session-id/deactivate
```

### POST /auth/sessions/deactivate-all
Deactivate all sessions for the user.

**Request:**
```bash
curl -X POST -H "x-session-id: your-session-id" \
  http://localhost:3000/auth/sessions/deactivate-all
```

## Spaces

### GET /spaces
List spaces for authenticated admin.

**Request:**
```bash
curl -H "x-session-id: your-session-id" \
  http://localhost:3000/spaces
```

**Response:**
```json
[
  {
    "did": "did:key:space-did-here",
    "name": "space-name"
  }
]
```

### GET /spaces/usage
Get space usage information (requires spaceDid query parameter and admin authentication).

**Request:**
```bash
curl -H "x-session-id: your-session-id" \
  "http://localhost:3000/spaces/usage?spaceDid=did:key:your-space-did"
```

**Response:**
```json
{
  "spaceDid": "did:key:your-space-did",
  "usage": {
    "bytes": 11744,
    "mb": 0.0112,
    "human": "0.0112 MB"
  }
}
```

### GET /spaces/account-usage
Get total storage usage across all spaces for the authenticated admin.

**Required header:** `x-session-id` (admin session ID)

**Description:** Returns the total storage usage for all spaces owned by the admin, as well as per-space usage breakdown.

**Request:**
```bash
curl -H "x-session-id: your-session-id" \
  http://localhost:3000/spaces/account-usage
```

**Response:**
```json
{
  "totalUsage": {
    "bytes": 307966,
    "mb": 0.2937,
    "human": "0.2937 MB"
  },
  "spaces": [
    {
      "spaceDid": "did:key:z6MkfUhCYVDxnnpw47uDESen3xhg5pYDY1SChD2TuxdEUHWA",
      "name": "delegation_test",
      "usage": {
        "bytes": 11744,
        "mb": 0.0112,
        "human": "0.0112 MB"
      }
    }
  ]
}
```

## Upload Paths

There are two ways to upload files:

### 1. Direct Upload via w3up HTTP API Bridge (✅ Working)

#### Step 1: Get authentication tokens for the bridge
```bash
curl -H "x-user-did: your-user-did" \
  "http://localhost:3000/bridge-tokens?spaceDid=your-space-did"
```

**Response:**
```json
{
  "headers": {
    "X-Auth-Secret": "your-auth-secret",
    "Authorization": "your-authorization-token"
  },
  "curlCommand": "curl -X POST \\\n  -H \"X-Auth-Secret: your-auth-secret\" \\\n  -H \"Authorization: your-authorization-token\" \\\n  -F \"file=@/path/to/your/file.txt\" \\\n  https://up.storacha.network/bridge",
  "note": "Replace /path/to/your/file.txt with actual file path for testing"
}
```

#### Step 2: Use tokens to upload directly to w3up HTTP API bridge
```bash
curl -X POST \
  -H "X-Auth-Secret: your-auth-secret" \
  -H "Authorization: your-authorization-token" \
  -F "file=@/path/to/file.png" \
  https://up.storacha.network/bridge
```

### 2. Upload through Token Service (✅ Working - Recommended)

**Request:**
```bash
curl -X POST \
  -H "x-user-did: your-user-did" \
  -F "file=@/path/to/file.png" \
  -F "spaceDid=your-space-did" \
  http://localhost:3000/upload
```

**Response:**
```json
{
  "success": true,
  "cid": "bafkreige7hs3pe3d2h3o5a2l2hfrbaafmb7anoxwszuyamhazoanygwebe",
  "size": 11744
}
```

This endpoint:
- Validates user delegation
- Handles file uploads securely
- Manages temporary files
- Provides proper error handling
- Supports all required capabilities for uploads

### GET /uploads
List uploads for a user in a specific space.

**Request:**
```bash
curl -H "x-user-did: your-user-did" \
  "http://localhost:3000/uploads?spaceDid=did:key:your-space-did"
```

**Response:**
```json
{
  "success": true,
  "userDid": "did:key:your-user-did",
  "spaceDid": "did:key:your-space-did",
  "uploads": [
    {
      "cid": "bafkreige7hs3pe3d2h3o5a2l2hfrbaafmb7anoxwszuyamhazoanygwebe",
      "size": 11744,
      "created": "2024-01-01T12:00:00.000Z",
      "gatewayUrl": "https://bafkreige7hs3pe3d2h3o5a2l2hfrbaafmb7anoxwszuyamhazoanygwebe.ipfs.w3s.link/"
    }
  ],
  "count": 1,
  "cursor": "next-page-cursor",
  "hasMore": true
}
```

## Delegations

### GET /delegations/user/spaces
List spaces accessible to a user.

**Request:**
```bash
curl -H "x-user-did: your-user-did" \
  http://localhost:3000/delegations/user/spaces
```

**Response:**
```json
{
  "userDid": "did:key:your-user-did",
  "spaces": ["did:key:space-did-here"],
  "expiresAt": "2025-06-11T18:16:13.737Z"
}
```

### GET /delegations/list
List delegations (admin only, requires session).

**Request:**
```bash
# List spaces for a user
curl -H "x-session-id: your-session-id" \
  "http://localhost:3000/delegations/list?userDid=did:key:user-did-here"

# List users for a space
curl -H "x-session-id: your-session-id" \
  "http://localhost:3000/delegations/list?spaceDid=did:key:space-did-here"
```

**Response (for user):**
```json
{
  "userDid": "did:key:user-did-here",
  "spaces": ["did:key:space-did-here"]
}
```

**Response (for space):**
```json
{
  "spaceDid": "did:key:space-did-here",
  "users": ["did:key:user-did-here"]
}
```

### POST /delegations/create
Create a delegation (admin only, requires session).

**Request:**
```bash
curl -X POST -H "x-session-id: your-session-id" \
  -H "Content-Type: application/json" \
  -d '{
    "userDid": "did:key:user-did-here",
    "spaceDid": "did:key:space-did-here",
    "expiresIn": 24
  }' \
  http://localhost:3000/delegations/create
```

**Response:**
```json
{
  "message": "Delegation created successfully",
  "principalDid": "did:key:derived-principal-did",
  "delegationCid": "bafy...",
  "expiresAt": "2025-06-11T18:16:13.737Z",
  "createdBy": "admin@example.com"
}
```

### GET /delegations/get
Get delegation details for a specific space.

**Request:**
```bash
curl -H "x-user-did: your-user-did" \
  "http://localhost:3000/delegations/get?spaceDid=did:key:space-did-here"
```

**Response:**
```json
{
  "userDid": "did:key:your-user-did",
  "spaceDid": "did:key:space-did-here",
  "delegationCar": "base64-encoded-delegation-car",
  "expiresAt": "2025-06-11T18:16:13.737Z"
}
```

### DELETE /delegations/revoke
Revoke a delegation (admin only, requires session).

**Request:**
```bash
curl -X DELETE \
  -H "x-session-id: your-session-id" \
  -H "Content-Type: application/json" \
  -d '{
    "userDid": "did:key:user-did-here",
    "spaceDid": "did:key:space-did-here"
  }' \
  http://localhost:3000/delegations/revoke
```

**Success Response (200):**
```json
{
  "message": "Delegations revoked successfully",
  "userDid": "did:key:...",
  "spaceDid": "did:key:...",
  "revokedCount": 1
}
```

**Error Responses:**

**400 - Missing required fields:**
```json
{
  "message": "userDid and spaceDid are required"
}
```

**404 - No active delegation found:**
```json
{
  "message": "No active delegation found for this user and space"
}
```

**500 - Server error:**
```json
{
  "message": "Failed to revoke delegations"
}
```

## Complete Examples

### Complete Example: Delegation and Upload

Here's a complete example of the delegation and upload process using real DIDs and responses from our successful implementation:

#### 1. Admin Login
```bash
# Login with email and DID
curl -X POST -H "Content-Type: application/json" \
  -d '{
    "email": "vincent@hypha.coop",
    "did": "did:key:z6MkujSWEBZStjaPYidedRXqWD3iNgkZuqBm32zHVbgSDJsY"
  }' \
  http://localhost:3000/auth/login

# Response:
{
  "message": "Login successful",
  "sessionId": "00b3d659c3816cd3ea8ffd6b6cdf8f8a",
  "did": "did:key:z6MkujSWEBZStjaPYidedRXqWD3iNgkZuqBm32zHVbgSDJsY"
}
```

#### 2. List Spaces
```bash
# List available spaces
curl -H "x-session-id: 00b3d659c3816cd3ea8ffd6b6cdf8f8a" \
  http://localhost:3000/spaces

# Response:
[
  {
    "did": "did:key:z6MkfUhCYVDxnnpw47uDESen3xhg5pYDY1SChD2TuxdEUHWA",
    "name": "delegation_test"
  },
  // ... more spaces ...
]
```

#### 3. Create Delegation
```bash
# Create delegation for a user
curl -X POST -H "x-session-id: 00b3d659c3816cd3ea8ffd6b6cdf8f8a" \
  -H "Content-Type: application/json" \
  -d '{
    "userDid": "did:key:z6MkfBpJtkRbCTeQES5wDFUfVPftFjjDhYf8KCrefyivHVsV",
    "spaceDid": "did:key:z6MkfUhCYVDxnnpw47uDESen3xhg5pYDY1SChD2TuxdEUHWA"
  }' \
  http://localhost:3000/delegations/create

# Response:
{
  "message": "Delegation created successfully",
  "principalDid": "did:key:z6MkfiSNrBMUzsdKQTfWkJrx8Ax79422KcM3VKsxGTwnc3Yb",
  "delegationCid": "bafyreiboy67cjt3wydr3r3tnirqadistzmlg2zi75npkhccrn4uus6rr7i",
  "expiresAt": "2025-06-11T18:16:13.737Z",
  "createdBy": "vincent@hypha.coop"
}
```

**Key Point**: Notice that the `principalDid` is different from the `userDid`. This is the derived principal that the admin delegates to.

#### 4. Verify User's Access
```bash
# Check spaces accessible to the user
curl -H "x-user-did: did:key:z6MkfBpJtkRbCTeQES5wDFUfVPftFjjDhYf8KCrefyivHVsV" \
  http://localhost:3000/delegations/user/spaces

# Response:
{
  "userDid": "did:key:z6MkfBpJtkRbCTeQES5wDFUfVPftFjjDhYf8KCrefyivHVsV",
  "spaces": ["did:key:z6MkfUhCYVDxnnpw47uDESen3xhg5pYDY1SChD2TuxdEUHWA"],
  "expiresAt": "2025-06-11T18:16:13.737Z"
}
```

#### 5. Upload File (Method 1: Direct Bridge Upload)
```bash
# Get authentication tokens
curl -H "x-user-did: did:key:z6MkfBpJtkRbCTeQES5wDFUfVPftFjjDhYf8KCrefyivHVsV" \
  "http://localhost:3000/bridge-tokens?spaceDid=did:key:z6MkfUhCYVDxnnpw47uDESen3xhg5pYDY1SChD2TuxdEUHWA"

# Response:
{
  "headers": {
    "X-Auth-Secret": "uOGQyYzRhYWQwNmY3NtEwOTg1ZWU0NDU0NjByNTg2ZGE",
    "Authorization": "uOqJlcm9vdHOB2CpYKQABcRIgYVymlT6sxiDd45CA0f..."
  },
  "curlCommand": "curl -X POST \\\n  -H \"X-Auth-Secret: uOGQyYzRhYWQwNmY3NtEwOTg1ZWU0NDU0NjByNTg2ZGE\" \\\n  -H \"Authorization: uOqJlcm9vdHOB2CpYKQABcRIgYVymlT6sxiDd45CA0f...\" \\\n  -F \"file=@/path/to/your/file.txt\" \\\n  https://up.storacha.network/bridge"
}

# Upload directly to Storacha bridge
curl -X POST \
  -H "X-Auth-Secret: uOGQyYzRhYWQwNmY3NtEwOTg1ZWU0NDU0NjByNTg2ZGE" \
  -H "Authorization: uOqJlcm9vdHOB2CpYKQABcRIgYVymlT6sxiDd45CA0f..." \
  -F "file=@/path/to/your/file.txt" \
  https://up.storacha.network/bridge
```

#### 6. Upload File (Method 2: Through Token Service)
```bash
# Create a test file
echo "Test upload after fix" > test-fix.txt

# Upload the file
curl -X POST \
  -H "x-user-did: did:key:z6MkfBpJtkRbCTeQES5wDFUfVPftFjjDhYf8KCrefyivHVsV" \
  -F "file=@test-fix.txt" \
  -F "spaceDid=did:key:z6MkfUhCYVDxnnpw47uDESen3xhg5pYDY1SChD2TuxdEUHWA" \
  http://localhost:3000/upload

# Response:
{
  "success": true,
  "cid": "bafkreicwoj7fsn5ok5eiqwvdmcgfqot6pitbi3gsvyubj4fujueiladxwm",
  "size": 22
}
```

#### 7. Check Space Usage
```bash
# Check space usage as admin
curl -H "x-session-id: 00b3d659c3816cd3ea8ffd6b6cdf8f8a" \
  "http://localhost:3000/spaces/usage?spaceDid=did:key:z6MkfUhCYVDxnnpw47uDESen3xhg5pYDY1SChD2TuxdEUHWA"

# Response:
{
  "spaceDid": "did:key:z6MkfUhCYVDxnnpw47uDESen3xhg5pYDY1SChD2TuxdEUHWA",
  "usage": {
    "bytes": 22,
    "mb": 0.000021,
    "human": "0.000021 MB"
  }
}
```

This example demonstrates:
- Complete admin login flow with real credentials
- Space listing
- Delegation creation with principal derivation
- Verification of user access
- Successful file upload with delegation (both methods)
- Usage monitoring

The delegation grants the user access to the space until the expiration date. The user can upload files to the space using their DID in the `x-user-did` header, and the system automatically handles the principal derivation and delegation validation.

### Complete Example: Revoking a Delegation

Here's a complete example of revoking a user's access to a space:

#### 1. Verify Current Access
```bash
# Check spaces accessible to the user before revocation
curl -H "x-user-did: did:key:z6Mknq1W5c3fRyry4vgw9VUitFJQZ1p9CyA9BBPyju9QHvAr" \
  http://localhost:3000/delegations/user/spaces

# Response:
{
  "userDid": "did:key:z6Mknq1W5c3fRyry4vgw9VUitFJQZ1p9CyA9BBPyju9QHvAr",
  "spaces": ["did:key:z6MkfUhCYVDxnnpw47uDESen3xhg5pYDY1SChD2TuxdEUHWA"],
  "expiresAt": "2025-06-06T17:48:53.116Z"
}
```

#### 2. Revoke the Delegation
```bash
# Revoke all delegations for the user in the space
curl -X DELETE \
  -H "x-session-id: c0035bba684a603a18c4aa2f548e32ff" \
  -H "Content-Type: application/json" \
  -d '{
    "userDid": "did:key:z6Mknq1W5c3fRyry4vgw9VUitFJQZ1p9CyA9BBPyju9QHvAr",
    "spaceDid": "did:key:z6MkfUhCYVDxnnpw47uDESen3xhg5pYDY1SChD2TuxdEUHWA"
  }' \
  http://localhost:3000/delegations/revoke

# Response:
{
  "message": "Delegations revoked successfully",
  "userDid": "did:key:z6Mknq1W5c3fRyry4vgw9VUitFJQZ1p9CyA9BBPyju9QHvAr",
  "spaceDid": "did:key:z6MkfUhCYVDxnnpw47uDESen3xhg5pYDY1SChD2TuxdEUHWA",
  "revokedCount": 1
}
```

#### 3. Verify Access is Revoked
```bash
# Check spaces accessible to the user after revocation
curl -H "x-user-did: did:key:z6Mknq1W5c3fRyry4vgw9VUitFJQZ1p9CyA9BBPyju9QHvAr" \
  http://localhost:3000/delegations/user/spaces

# Response:
{
  "userDid": "did:key:z6Mknq1W5c3fRyry4vgw9VUitFJQZ1p9CyA9BBPyju9QHvAr",
  "spaces": [],
  "expiresAt": null
}
```

#### 4. Verify Upload is Blocked
```bash
# Attempt to upload a file (should fail)
echo "Test upload after revocation" > test-revocation.txt
curl -X POST \
  -H "x-user-did: did:key:z6Mknq1W5c3fRyry4vgw9VUitFJQZ1p9CyA9BBPyju9QHvAr" \
  -F "file=@test-revocation.txt" \
  -F "spaceDid=did:key:z6MkfUhCYVDxnnpw47uDESen3xhg5pYDY1SChD2TuxdEUHWA" \
  http://localhost:3000/upload

# Response:
{
  "error": "No valid delegation found",
  "userDid": "did:key:z6Mknq1W5c3fRyry4vgw9VUitFJQZ1p9CyA9BBPyju9QHvAr"
}
```

This example demonstrates:
- Checking user's access before revocation
- Revoking a delegation using admin session
- Verifying that access is revoked
- Confirming that uploads are blocked after revocation

The revocation process is immediate and permanent. Once a delegation is revoked:
- The user loses access to the space
- Any attempts to upload files will fail
- The user's spaces list will be empty
- A new delegation must be created to restore access

## Error Handling

All endpoints may return the following error responses:

### 400 Bad Request
```json
{
  "error": "Error description",
  "message": "Detailed error message"
}
```

### 401 Unauthorized
```json
{
  "error": "Unauthorized",
  "message": "Invalid or missing session"
}
```

### 403 Forbidden
```json
{
  "error": "Forbidden",
  "message": "Insufficient permissions"
}
```

### 404 Not Found
```json
{
  "error": "Not found",
  "message": "Resource not found"
}
```

### 500 Internal Server Error
```json
{
  "error": "Internal server error",
  "message": "An unexpected error occurred"
}
```

## Headers

### Authentication Headers
- `x-session-id`: Admin session ID (required for admin operations)
- `x-user-did`: User DID (required for user operations)

### Content Headers
- `Content-Type: application/json`: For JSON requests
- `Content-Type: multipart/form-data`: For file uploads

## Rate Limiting

The API implements rate limiting:
- **General requests**: 100 requests per 15 minutes per IP
- **Upload requests**: 10 uploads per hour per IP

Rate limit information is returned in the `RateLimit-*` headers.

## Pagination

The `/uploads` endpoint supports pagination:
- `cursor`: For pagination (optional)
- `size`: Page size (default: 25, optional)

## Versioning

The API is currently in version 1.0. Future versions will be versioned through URL paths (e.g., `/v2/`) or headers. 