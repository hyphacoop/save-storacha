# API Documentation

This document provides detailed API endpoint documentation for the save_storacha service.

## Base URL

All endpoints are relative to `http://localhost:3000` (or your configured server URL).

## Endpoint Index

| Method | Path | Description |
| ------ | ---- | ----------- |
| POST | /auth/login | Initiates an asynchronous login. |
| POST | /auth/login/did | Admin login via DID only |
| POST | /auth/verify | DID signature verification endpoint |
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
| POST | /bridge-tokens | Generate bridge tokens for Storacha HTTP API bridge |
| GET  | /uploads | List uploads for user+space (supports both admin and delegated user access) |
| GET  | /delegations/user/spaces | Spaces accessible to a user |
| GET  | /delegations/list | List delegations |
| POST | /delegations/create | Create delegation |
| GET  | /delegations/get | Get delegation details |
| DELETE | /delegations/revoke | Revoke delegation |

## Authentication

### DID-Based Cryptographic Authentication

The system uses DID-based cryptographic authentication using Ed25519 signatures. 

**Authentication Flow:**
1. **Login Initiation**: Client calls `/auth/login` with email and DID
2. **Challenge Generation**: Server generates a unique cryptographic challenge
3. **Challenge Signing**: Client signs the challenge with their Ed25519 private key
4. **Signature Verification**: Client calls `/auth/verify` with the signature
5. **Session Authentication**: Server verifies the signature and authenticates the session

**Security Features:**
- **Time-bound challenges**: 5-minute expiration prevents replay attacks
- **One-time use**: Each challenge can only be used once
- **Ed25519 signatures**: Cryptographically secure signature algorithm
- **DID validation**: Ensures proper DID format and key extraction
- **Challenge-response**: Prevents man-in-the-middle attacks

**Example Flow:**
```bash
# 1. Initiate login and get challenge
curl -X POST -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "did": "did:key:z6MkexampleUserDIDforDocumentation123456789abcdef"
  }' \
  http://localhost:3000/auth/login

# Response includes challenge for signing
{
  "message": "Login initiated. Please verify your email. Poll the session endpoint for completion.",
  "sessionId": "your-session-id",
  "did": "did:key:z6MkexampleUserDIDforDocumentation123456789abcdef",
  "verified": false,
  "challenge": "did:key:z6MkexampleUserDIDforDocumentation123456789abcdef:1753721491465:randombytes",
  "challengeId": "challenge-uuid"
}

# 2. Sign the challenge with Ed25519 private key (client-side)
# signature = ed25519_sign(challenge, private_key)

# 3. Verify signature
curl -X POST -H "Content-Type: application/json" \
  -d '{
    "did": "did:key:z6MkexampleUserDIDforDocumentation123456789abcdef",
    "challengeId": "challenge-uuid",
    "signature": "base64-encoded-signature",
    "sessionId": "your-session-id",
    "email": "user@example.com"
  }' \
  http://localhost:3000/auth/verify

# Response confirms authentication
{
  "sessionId": "your-session-id",
  "did": "did:key:z6MkexampleUserDIDforDocumentation123456789abcdef",
  "message": "Authentication successful"
}
```

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

### POST /auth/verify
DID signature verification endpoint for cryptographic authentication.

This endpoint completes the DID-based authentication flow by verifying a signed challenge. The client must first obtain a challenge from the login endpoint, sign it with their Ed25519 private key, and then submit the signature for verification.

**Request:**
```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{
    "did": "did:key:z6MkexampleUserDIDforDocumentation123456789abcdef",
    "challengeId": "challenge-uuid-from-login",
    "signature": "base64-encoded-signature-of-challenge",
    "sessionId": "session-id-from-login",
    "email": "your-email@example.com"
  }' \
  http://localhost:3000/auth/verify
```

**Request Parameters:**
- `did` (required): The client's decentralized identifier
- `challengeId` (required): The challenge identifier from the login call
- `signature` (required): Base64-encoded signature of the challenge
- `sessionId` (required): The session ID from the login call to update
- `email` (optional): Email address for enhanced user identification

**Response (Success):**
```json
{
  "sessionId": "your-session-id",
  "did": "did:key:z6MkexampleUserDIDforDocumentation123456789abcdef",
  "message": "Authentication successful"
}
```

**Response (Invalid Signature):**
```json
{
  "error": "Invalid signature or expired challenge"
}
```

**Response (Missing Parameters):**
```json
{
  "error": "DID is required"
}
```

**Authentication Flow:**
1. Client calls `/auth/login` to initiate login and receive a challenge
2. Client signs the challenge with their Ed25519 private key
3. Client calls `/auth/verify` with the signature and challenge ID
4. Server verifies the signature against the DID's public key
5. Server updates the session as authenticated upon successful verification

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

## Bridge Tokens

### POST /bridge-tokens

Generate authentication tokens for the Storacha HTTP API bridge. This endpoint supports both admin and delegated user authentication.

**Authentication:** Flexible - supports two authentication methods:
- **Admin users:** `x-session-id` header (session ID) - Direct access to admin spaces
- **Delegated users:** `x-user-did` header (user DID) - Delegation-based access

**Request Body:**
```json
{
  "resource": "did:key:z6MkexampleSpaceDIDforDocumentation987654321fedcba",
  "can": "store/add",
  "expiration": "2025-12-31T23:59:59Z"
}
```

**Admin Request:**
```bash
curl -X POST \
  -H "x-session-id: your-session-id" \
  -H "Content-Type: application/json" \
  -d '{
    "resource": "did:key:z6MkexampleSpaceDIDforDocumentation987654321fedcba",
    "can": "store/add"
  }' \
  http://localhost:3000/bridge-tokens
```

**Delegated User Request:**
```bash
curl -X POST \
  -H "x-user-did: did:key:z6MkexampleUserDIDforDocumentation123456789abcdef" \
  -H "Content-Type: application/json" \
  -d '{
    "resource": "did:key:z6MkexampleSpaceDIDforDocumentation987654321fedcba",
    "can": "store/add"
  }' \
  http://localhost:3000/bridge-tokens
```

**Response:**
```json
{
  "headers": {
    "X-Auth-Secret": "uZTBiYjYxZTY1YWM2Y2M...",
    "Authorization": "uOqJlcm9vdHOB2CpYJQABcRIg..."
  }
}
```

**Usage Notes:**
- **Token Expiration**: Tokens expire quickly (minutes, not hours) - always generate fresh tokens for each operation
- **Capabilities**: Supports `store/add` and `upload/add` capabilities
- **Space Validation**: Automatically validates user access to the specified space
- **Delegation Support**: For delegated users, automatically uses the admin's client with proper delegation context

## Upload Paths

There are two ways to upload files:

### 1. Direct Upload via Storacha HTTP API Bridge (✅ Working)

#### Step 1: Get authentication tokens for the bridge
Use the `POST /bridge-tokens` endpoint as documented above.

#### Step 2: Complete Bridge Upload Workflow

The Storacha HTTP API bridge uses a two-step process:

**Step 2a: Store the file (store/add)**
```bash
curl -X POST \
  -H "X-Auth-Secret: your-auth-secret" \
  -H "Authorization: your-authorization-token" \
  -H "Content-Type: application/json" \
  -d '{
    "tasks": [
      [
        "store/add",
        "did:key:z6MkexampleSpaceDIDforDocumentation987654321fedcba",
        {
          "link": { "/": "bagbaiera4tntawdwlxf33uld7hd5yfaadct5galsr45vawbomjbiytdx4dzq" },
          "size": 161
        }
      ]
    ]
  }' \
  https://up.storacha.network/bridge
```

**Response:**
```json
{
  "p": {
    "out": {
      "ok": {
        "status": "upload",
        "url": "https://carpark-prod-0.s3.us-west-2.amazonaws.com/...",
        "headers": {
          "content-length": "161",
          "x-amz-checksum-sha256": "..."
        }
      }
    }
  }
}
```

**Step 2b: Upload CAR file to S3**
```bash
curl -X PUT \
  -H "content-length: 161" \
  -H "x-amz-checksum-sha256: 5NswWHZdy73RY/nH3BQAGKfTAXKPO1BYLmJCjEx34PM=" \
  --data-binary @your-file.car \
  "https://carpark-prod-0.s3.us-west-2.amazonaws.com/..."
```

**Step 2c: Register the upload (upload/add)**
```bash
curl -X POST \
  -H "X-Auth-Secret: your-auth-secret" \
  -H "Authorization: your-authorization-token" \
  -H "Content-Type: application/json" \
  -d '{
    "tasks": [
      [
        "upload/add",
        "did:key:z6MkexampleSpaceDIDforDocumentation987654321fedcba",
        {
          "root": { "/": "bafybeidhkumeonuwkebh2i4fc7o7lguehauradvlk57gzake6ggjsy372a" }
        }
      ]
    ]
  }' \
  https://up.storacha.network/bridge
```

**Important Notes:**
- **No shards field**: Small uploads work without the `shards` field in payloads
- **Token expiration**: Tokens expire quickly - always use fresh tokens
- **CAR files**: Files must be packed as CAR files before upload
- **Two-step process**: `store/add` → S3 upload → `upload/add` is required

**Recommendation**: Use the proven working E2E test scripts instead of manual testing to avoid common pitfalls like token expiration and payload construction errors.

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

**Authentication:** Flexible - supports two authentication methods:
- **Admin users:** `x-session-id` header (session ID) - Direct access to admin spaces
- **Delegated users:** `x-user-did` header (user DID) - Delegation-based access

**Query Parameters:**
- `spaceDid` (required): The DID of the space to list uploads for
- `cursor` (optional): Pagination cursor for next page
- `size` (optional): Number of results per page (default: 25)

**Admin Request (Direct Access):**
```bash
curl -H "x-session-id: your-session-id" \
  "http://localhost:3000/uploads?spaceDid=did:key:z6MkexampleSpaceDIDforDocumentation987654321fedcba"
```

**Delegated User Request (Delegation Required):**
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

**Access Patterns:**

**Admin Access (No Delegation Required):**
- Admins can list uploads in any of their admin spaces directly
- Uses session-based authentication (`x-session-id`)
- No delegation creation required
- Access is granted through admin privilege escalation

**Delegated User Access (Delegation Required):**
- Users can only list uploads in spaces they have been delegated to
- Uses DID-based authentication (`x-user-did`)
- Requires explicit delegation from an admin
- Access is controlled through delegation validation

**Error Responses:**

**403 Forbidden - No Delegation (Delegated User):**
```json
{
  "error": "No valid delegation found for this space",
  "userDid": "did:key:z6MkexampleUserDIDforDocumentation123456789abcdef",
  "spaceDid": "did:key:z6MkexampleSpaceDIDforDocumentation987654321fedcba",
  "availableSpaces": ["did:key:z6MkexampleSpaceDIDforDocumentation987654321fedcba"]
}
```

**403 Forbidden - No Admin Access (Admin):**
```json
{
  "error": "Admin does not have access to this space",
  "adminEmail": "admin@example.com",
  "spaceDid": "did:key:z6MkexampleSpaceDIDforDocumentation987654321fedcba"
}
```

**Note:** This endpoint uses the system's dual access pattern where admins have direct access to their spaces while delegated users require explicit delegations.

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

### Complete Example: DID-Based Cryptographic Authentication

Here's a complete example of the DID-based cryptographic authentication flow:

#### 1. Initiate Login with Challenge
```bash
# Login with email and DID to get a challenge
curl -X POST -H "Content-Type: application/json" \
  -d '{
    "email": "admin@email.net",
    "did": "did:key:z6MkexampleUserDIDforDocumentation123456789abcdef"
  }' \
  http://localhost:3000/auth/login

# Response:
{
  "message": "Login initiated. Please verify your email. Poll the session endpoint for completion.",
  "sessionId": "be2963fe916318160a98b83405cd1b90",
  "did": "did:key:z6MkexampleUserDIDforDocumentation123456789abcdef",
  "verified": false,
  "challenge": "did:key:z6MkexampleUserDIDforDocumentation123456789abcdef:1753721491465:a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456",
  "challengeId": "550e8400-e29b-41d4-a716-446655440000"
}
```

#### 2. Sign the Challenge (Client-Side)
```javascript
// Using a cryptographic library to sign the challenge
const challenge = "did:key:z6MkexampleUserDIDforDocumentation123456789abcdef:1753721491465:a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456";
const privateKey = "your-ed25519-private-key";
const signature = ed25519.sign(challenge, privateKey);
const base64Signature = btoa(String.fromCharCode(...signature));
```

#### 3. Verify Signature
```bash
# Submit the signature for verification
curl -X POST -H "Content-Type: application/json" \
  -d '{
    "did": "did:key:z6MkexampleUserDIDforDocumentation123456789abcdef",
    "challengeId": "550e8400-e29b-41d4-a716-446655440000",
    "signature": "base64-encoded-signature-from-step-2",
    "sessionId": "be2963fe916318160a98b83405cd1b90",
    "email": "admin@email.net"
  }' \
  http://localhost:3000/auth/verify

# Response:
{
  "sessionId": "be2963fe916318160a98b83405cd1b90",
  "did": "did:key:z6MkexampleUserDIDforDocumentation123456789abcdef",
  "message": "Authentication successful"
}
```

#### 4. Verify Session Status
```bash
# Check that the session is now authenticated
curl -H "x-session-id: be2963fe916318160a98b83405cd1b90" \
  http://localhost:3000/auth/session

# Response:
{
  "valid": true,
  "verified": true,
  "expiresAt": "2024-03-21T12:00:00.000Z",
  "message": "Session is valid"
}
```

This example demonstrates:
- Challenge generation during login
- Client-side signature creation
- Server-side signature verification
- Session authentication upon successful verification

### Complete Example: Delegation and Upload

Here's a complete example of the delegation and upload process using real DIDs and responses from our successful implementation:

#### 1. Login as seen above

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
# For admin users
curl -X POST \
  -H "x-session-id: your-session-id" \
  -H "Content-Type: application/json" \
  -d '{
    "resource": "did:key:z6MkexampleSpaceDIDforDocumentation987654321fedcba",
    "can": "store/add"
  }' \
  http://localhost:3000/bridge-tokens

# For delegated users
curl -X POST \
  -H "x-user-did: did:key:z6MkexampleUserDIDforDocumentation123456789abcdef" \
  -H "Content-Type: application/json" \
  -d '{
    "resource": "did:key:z6MkexampleSpaceDIDforDocumentation987654321fedcba",
    "can": "store/add"
  }' \
  http://localhost:3000/bridge-tokens





**Complete Bridge Upload Workflow:**

**Step 5b: Store the file (store/add)**
```bash
curl -X POST \
  -H "X-Auth-Secret: your-auth-secret" \
  -H "Authorization: your-authorization-token" \
  -H "Content-Type: application/json" \
  -d '{
    "tasks": [
      [
        "store/add",
        "did:key:z6MkexampleSpaceDIDforDocumentation987654321fedcba",
        {
          "link": { "/": "bagbaiera4tntawdwlxf33uld7hd5yfaadct5galsr45vawbomjbiytdx4dzq" },
          "size": 161
        }
      ]
    ]
  }' \
  https://up.storacha.network/bridge
```

**Step 5c: Upload CAR file to S3**
```bash
curl -X PUT \
  -H "content-length: 161" \
  -H "x-amz-checksum-sha256: 5NswWHZdy73RY/nH3BQAGKfTAXKPO1BYLmJCjEx34PM=" \
  --data-binary @your-file.car \
  "https://carpark-prod-0.s3.us-west-2.amazonaws.com/..."
```

**Step 5d: Register the upload (upload/add)**
```bash
curl -X POST \
  -H "X-Auth-Secret: your-auth-secret" \
  -H "Authorization: your-authorization-token" \
  -H "Content-Type: application/json" \
  -d '{
    "tasks": [
      [
        "upload/add",
        "did:key:z6MkexampleSpaceDIDforDocumentation987654321fedcba",
        {
          "root": { "/": "bafybeidhkumeonuwkebh2i4fc7o7lguehauradvlk57gzake6ggjsy372a" }
        }
      ]
    ]
  }' \
  https://up.storacha.network/bridge
```

#### 6. Upload File (Method 2: Through Token Service)
```bash
# Create a test file
echo "Test upload" > test-upload.txt

# Upload the file
curl -X POST \
  -H "x-user-did: did:key:z6MkexampleUserDIDforDocumentation123456789abcdef" \
  -F "file=@test-upload.txt" \
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