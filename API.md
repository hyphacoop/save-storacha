# API Documentation

This document provides detailed API endpoint documentation for the save_storacha service.

## Base URL

All endpoints are relative to `http://localhost:3000` (or your configured server URL).

## Endpoint Index

| Method | Path | Description |
| ------ | ---- | ----------- |
| POST | /auth/login | Initiates an asynchronous login. |
| POST | /auth/login/did | Admin login via DID only |
| GET  | /auth/session | Validate session and check verification status. |
| POST | /auth/logout | End session |
| POST | /auth/w3up/logout | Logout from w3up service |
| GET  | /auth/sessions | List sessions |
| POST | /auth/sessions/:id/deactivate | Deactivate a session |
| POST | /auth/sessions/deactivate-all | Deactivate all sessions |
| GET  | /spaces | List all spaces available to a user, including both admin spaces and delegated spaces |
| GET  | /spaces/usage | Usage for a space |
| GET  | /spaces/account-usage | Total account usage |
| POST | /upload | Upload through token service |
| GET  | /bridge-tokens | Get direct-bridge auth headers |
| GET  | /uploads | List uploads for user+space |
| GET  | /delegations/user/spaces | Spaces accessible to a user |
| GET  | /delegations/list | List delegations |
| POST | /delegations/create | Create delegation |
| GET  | /delegations/get | Get delegation details |
| DELETE | /delegations/revoke | Revoke delegation |

## Authentication

### POST /auth/login
Initiates a unified, asynchronous login for an admin user using their email and DID.

This endpoint starts the login process and returns immediately with a session ID. The email verification and account setup happen in the background. Clients should use the `GET /auth/session` endpoint to poll for the completion of the verification process.

**Request:**
```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{
    "email": "your-email@example.com",
    "did": "did:key:z6MkexampleUserDIDforDocumentation123456789abcdef"
  }' \
  http://localhost:3000/auth/login
```

**Response (Initial Login):**
For a first-time login, the server returns an unverified session.
```json
{
  "message": "Login initiated. Please verify your email. Poll the session endpoint for completion.",
  "sessionId": "your-session-id",
  "did": "did:key:z6MkexampleUserDIDforDocumentation123456789abcdef",
  "verified": false
}
```

**Response (Subsequent Login):**
For a returning user who has already verified, the server returns an already-verified session.
```json
{
  "message": "Subsequent login successful",
  "sessionId": "your-session-id",
  "did": "did:key:z6MkexampleUserDIDforDocumentation123456789abcdef",
  "verified": true
}
```

### POST /auth/login/did
Admin login with DID only (for subsequent logins).

**Request:**
```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{
    "did": "did:key:z6MkexampleUserDIDforDocumentation123456789abcdef"
  }' \
  http://localhost:3000/auth/login/did
```

**Response:**
```json
{
  "message": "Login successful",
  "sessionId": "your-session-id",
  "did": "did:key:z6MkexampleUserDIDforDocumentation123456789abcdef"
}
```

### GET /auth/session
Validates a session ID and checks its verification status. Clients should poll this endpoint after calling `/auth/login` to see when the `verified` flag becomes `true`.

**Request:**
```bash
curl -H "x-session-id: your-session-id" \
  http://localhost:3000/auth/session
```

**Response (Not Yet Verified):**
```json
{
  "valid": true,
  "verified": false,
  "expiresAt": "2024-03-21T12:00:00.000Z",
  "message": "Session is valid"
}
```

**Response (Verified):**
```json
{
  "valid": true,
  "verified": true,
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
List all spaces available to a user, including both admin spaces and delegated spaces.

**Authentication:** Flexible - supports two authentication methods:
- **Admin users:** `x-session-id` header (session ID)
- **Delegated users:** `x-user-did` header (user DID)

**Description:** Returns all spaces that the user has access to, with an `isAdmin` flag indicating whether they have admin privileges for each space. If a user has both admin and delegated access to a space, they will see `isAdmin: true`.

**Admin Request:**
```bash
curl -H "x-session-id: your-session-id" \
  http://localhost:3000/spaces
```

**Delegated User Request:**
```bash
curl -H "x-user-did: did:key:z6MkexampleUserDIDforDocumentation123456789abcdef" \
  http://localhost:3000/spaces
```

**Response:**
```json
[
  {
    "did": "did:key:z6MkexampleSpaceDIDforDocumentation987654321fedcba",
    "name": "space-name",
    "isAdmin": true  // true for admin spaces, false for delegated spaces
  }
]
```

**Note:** The `isAdmin` flag can be used to determine what actions are available for each space:
- `isAdmin: true` - User can create delegations and manage the space
- `isAdmin: false` - User can only perform delegated actions (e.g., uploads)

### GET /spaces/usage
Get space usage information for a specific space. User must have access to the space (either as admin or through delegation).

**Authentication:** Flexible - supports two authentication methods:
- **Admin users:** `x-session-id` header (session ID)
- **Delegated users:** `x-user-did` header (user DID)

**Query Parameters:**
- `spaceDid` (required): The DID of the space to check usage for

**Admin Request:**
```bash
curl -H "x-session-id: your-session-id" \
  "http://localhost:3000/spaces/usage?spaceDid=did:key:z6MkexampleSpaceDIDforDocumentation987654321fedcba"
```

**Delegated User Request:**
```bash
curl -H "x-user-did: did:key:z6MkexampleUserDIDforDocumentation123456789abcdef" \
  "http://localhost:3000/spaces/usage?spaceDid=did:key:z6MkexampleSpaceDIDforDocumentation987654321fedcba"
```

**Response:**
```json
{
  "spaceDid": "did:key:z6MkexampleSpaceDIDforDocumentation987654321fedcba",
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
      "spaceDid": "did:key:z6MkexampleSpaceDIDforDocumentation987654321fedcba",
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
curl -H "x-user-did: did:key:z6MkexampleUserDIDforDocumentation123456789abcdef" \
  "http://localhost:3000/bridge-tokens?spaceDid=did:key:z6MkexampleSpaceDIDforDocumentation987654321fedcba"
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

### 2. Upload through Token Service (✅ Working - Recommended for now)

**Authentication:** `x-user-did` header (user DID)

**Form Parameters:**
- `file` (required): The file to upload
- `spaceDid` (required): The DID of the space to upload to

**Request:**
```bash
curl -X POST \
  -H "x-user-did: did:key:z6MkexampleUserDIDforDocumentation123456789abcdef" \
  -F "file=@HELLO_WORLD.txt" \
  -F "spaceDid=did:key:z6MkexampleSpaceDIDforDocumentation987654321fedcba" \
  http://localhost:3000/upload
```

**Response:**
```json
{
  "success": true,
  "cid": "bafkreiexampleCIDforDocumentation1234567890abcdef",
  "size": 17
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

**Authentication:** `x-user-did` header (user DID)

**Query Parameters:**
- `spaceDid` (required): The DID of the space to list uploads for
- `cursor` (optional): Pagination cursor for next page
- `size` (optional): Number of results per page (default: 25)

**Request:**
```bash
curl -H "x-user-did: did:key:z6MkexampleUserDIDforDocumentation123456789abcdef" \
  "http://localhost:3000/uploads?spaceDid=did:key:z6MkexampleSpaceDIDforDocumentation987654321fedcba"
```

**Response:**
```json
{
  "success": true,
  "userDid": "did:key:z6MkexampleUserDIDforDocumentation123456789abcdef",
  "spaceDid": "did:key:z6MkexampleSpaceDIDforDocumentation987654321fedcba",
  "uploads": [
    {
      "cid": "bafkreiexampleCIDforFile1234567890documentation",
      "created": "2025-06-26T15:27:28.023Z",
      "insertedAt": "2025-06-26T15:27:28.023Z",
      "updatedAt": "2025-06-26T15:27:28.023Z",
      "gatewayUrl": "https://bafkreiexampleCIDforFile1234567890documentation.ipfs.w3s.link/"
    },
    {
      "cid": "bafkreiexampleCIDforFile0987654321documentation",
      "created": "2025-06-26T15:26:55.022Z",
      "insertedAt": "2025-06-26T15:26:55.022Z",
      "updatedAt": "2025-06-26T15:26:55.022Z",
      "gatewayUrl": "https://bafkreiexampleCIDforFile0987654321documentation.ipfs.w3s.link/"
    }
  ],
  "count": 2,
  "cursor": "bafkreiexampleCIDforFile1234567890documentation",
  "hasMore": true
}
```

**Note:** This endpoint requires the user to have valid delegation access to the specified space. The response includes all uploads with their CIDs, timestamps, and IPFS gateway URLs for direct access.

## Delegations

### GET /delegations/user/spaces
List spaces accessible to a user.

**Request:**
```bash
curl -H "x-user-did: did:key:z6MkexampleUserDIDforDocumentation123456789abcdef" \
  http://localhost:3000/delegations/user/spaces
```

**Response:**
```json
{
  "userDid": "did:key:z6MkexampleUserDIDforDocumentation123456789abcdef",
  "spaces": ["did:key:z6MkexampleSpaceDIDforDocumentation987654321fedcba"],
  "expiresAt": "2025-06-11T18:16:13.737Z"
}
```

### GET /delegations/list
List delegations (admin only, requires session).

**Request:**
```bash
# List spaces for a user
curl -H "x-session-id: your-session-id" \
  "http://localhost:3000/delegations/list?userDid=did:key:z6MkexampleUserDIDforDocumentation123456789abcdef"

# List users for a space
curl -H "x-session-id: your-session-id" \
  "http://localhost:3000/delegations/list?spaceDid=did:key:z6MkexampleSpaceDIDforDocumentation987654321fedcba"
```

**Response (for user):**
```json
{
  "userDid": "did:key:z6MkexampleUserDIDforDocumentation123456789abcdef",
  "spaces": ["did:key:z6MkexampleSpaceDIDforDocumentation987654321fedcba"]
}
```

**Response (for space):**
```json
{
  "spaceDid": "did:key:z6MkexampleSpaceDIDforDocumentation987654321fedcba",
  "users": ["did:key:z6MkexampleUserDIDforDocumentation123456789abcdef"]
}
```

### POST /delegations/create
Create a delegation (admin only, requires session).

**Request:**
```bash
curl -X POST -H "x-session-id: your-session-id" \
  -H "Content-Type: application/json" \
  -d '{
    "userDid": "did:key:z6MkexampleUserDIDforDocumentation123456789abcdef",
    "spaceDid": "did:key:z6MkexampleSpaceDIDforDocumentation987654321fedcba",
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
curl -H "x-user-did: did:key:z6MkexampleUserDIDforDocumentation123456789abcdef" \
  "http://localhost:3000/delegations/get?spaceDid=did:key:z6MkexampleSpaceDIDforDocumentation987654321fedcba"
```

**Response:**
```json
{
  "userDid": "did:key:z6MkexampleUserDIDforDocumentation123456789abcdef",
  "spaceDid": "did:key:z6MkexampleSpaceDIDforDocumentation987654321fedcba",
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
    "userDid": "did:key:z6MkexampleUserDIDforDocumentation123456789abcdef",
    "spaceDid": "did:key:z6MkexampleSpaceDIDforDocumentation987654321fedcba"
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
    "email": "admin@email.net",
    "did": "did:key:example-admin-did"
  }' \
  http://localhost:3000/auth/login

# Response:
{
  "message": "Login successful",
  "sessionId": "00b3d659c3816cd3ea8ffd6b6cdf8f8a",
  "did": "did:key:example-admin-did",
  "verified": true
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
    "did": "did:key:z6MkexampleSpaceDIDforDocumentation987654321fedcba",
    "name": "delegation_test",
    "isAdmin": true
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
    "userDid": "did:key:z6MkexampleUserDIDforDocumentation123456789abcdef",
    "spaceDid": "did:key:z6MkexampleSpaceDIDforDocumentation987654321fedcba"
  }' \
  http://localhost:3000/delegations/create

# Response:
{
  "message": "Delegation created successfully",
  "principalDid": "did:key:example-principal-did",
  "delegationCid": "bafyreiboy67cjt3wydr3r3tnirqadistzmlg2zi75npkhccrn4uus6rr7i",
  "expiresAt": "2025-06-11T18:16:13.737Z",
  "createdBy": "admin@email.net"
}
```

**Key Point**: Notice that the `principalDid` is different from the `userDid`. This is the derived principal that the admin delegates to.

#### 4. Verify User's Access
```bash
# Check spaces accessible to the user
curl -H "x-user-did: did:key:z6MkexampleUserDIDforDocumentation123456789abcdef" \
  http://localhost:3000/delegations/user/spaces

# Response:
{
  "userDid": "did:key:z6MkexampleUserDIDforDocumentation123456789abcdef",
  "spaces": ["did:key:z6MkexampleSpaceDIDforDocumentation987654321fedcba"],
  "expiresAt": "2025-06-11T18:16:13.737Z"
}
```

#### 5. Upload File (Method 1: Direct Bridge Upload)
```bash
# Get authentication tokens
curl -H "x-user-did: did:key:z6MkexampleUserDIDforDocumentation123456789abcdef" \
  "http://localhost:3000/bridge-tokens?spaceDid=did:key:z6MkexampleSpaceDIDforDocumentation987654321fedcba"

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
  -H "x-user-did: did:key:z6MkexampleUserDIDforDocumentation123456789abcdef" \
  -F "file=@test-fix.txt" \
  -F "spaceDid=did:key:z6MkexampleSpaceDIDforDocumentation987654321fedcba" \
  http://localhost:3000/upload

# Response:
{
  "success": true,
  "cid": "bafkreiexampleCIDforUpload123456789abcdef",
  "size": 22
}
```

#### 7. Check Space Usage
```bash
# Check space usage as admin
curl -H "x-session-id: 00b3d659c3816cd3ea8ffd6b6cdf8f8a" \
  "http://localhost:3000/spaces/usage?spaceDid=did:key:z6MkexampleSpaceDIDforDocumentation987654321fedcba"

# Response:
{
  "spaceDid": "did:key:z6MkexampleSpaceDIDforDocumentation987654321fedcba",
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
curl -H "x-user-did: did:key:z6MkexampleUserDIDforDocumentation123456789abcdef" \
  http://localhost:3000/delegations/user/spaces

# Response:
{
  "userDid": "did:key:z6MkexampleUserDIDforDocumentation123456789abcdef",
  "spaces": ["did:key:z6MkexampleSpaceDIDforDocumentation987654321fedcba"],
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
    "userDid": "did:key:z6MkexampleUserDIDforDocumentation123456789abcdef",
    "spaceDid": "did:key:z6MkexampleSpaceDIDforDocumentation987654321fedcba"
  }' \
  http://localhost:3000/delegations/revoke

# Response:
{
  "message": "Delegations revoked successfully",
  "userDid": "did:key:z6MkexampleUserDIDforDocumentation123456789abcdef",
  "spaceDid": "did:key:z6MkexampleSpaceDIDforDocumentation987654321fedcba",
  "revokedCount": 1
}
```

#### 3. Verify Access is Revoked
```bash
# Check spaces accessible to the user after revocation
curl -H "x-user-did: did:key:z6MkexampleUserDIDforDocumentation123456789abcdef" \
  http://localhost:3000/delegations/user/spaces

# Response:
{
  "userDid": "did:key:z6MkexampleUserDIDforDocumentation123456789abcdef",
  "spaces": [],
  "expiresAt": null
}
```

#### 4. Verify Upload is Blocked
```bash
# Attempt to upload a file (should fail)
echo "Test upload after revocation" > test-revocation.txt
curl -X POST \
  -H "x-user-did: did:key:z6MkexampleUserDIDforDocumentation123456789abcdef" \
  -F "file=@test-revocation.txt" \
  -F "spaceDid=did:key:z6MkexampleSpaceDIDforDocumentation987654321fedcba" \
  http://localhost:3000/upload

# Response:
{
  "error": "No valid delegation found",
  "userDid": "did:key:z6MkexampleUserDIDforDocumentation123456789abcdef"
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

## Legacy / Deprecated Endpoints

### POST /auth/login/email _(Deprecated)_
This endpoint initiated w3up email validation. It remains for backward-compatibility but will be removed in a future release. Use **POST /auth/login** instead.

**Request:**
```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{
    "email": "your-email@example.com",
    "did": "did:key:z6MkexampleUserDIDforDocumentation123456789abcdef"
  }' \
  http://localhost:3000/auth/login/email
```

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
- `