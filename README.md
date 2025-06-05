# save_storacha

A service for managing secure file uploads to Filecoin using Storacha.

## Implementation Status

### Completed features
- Token service 
    - Admin authentication flow with w3up protocol
    - Space management for admins
- Session management with secure token handling
- Admin Service DID (ASSD) generation and delegation
- Space listing and management endpoints
- Space import and delegation endpoints
- W3up client persistence and initialization
- Space caching mechanism
- File upload implementation
    - User delegation system with CAR file handling
    - Secure file uploads to spaces
    - Space usage tracking and monitoring
    - Temporary file management
    - Delegation chain validation

### 🚧 In Progress
- Storage persistence layer optimization
- Upload progress tracking
- Storage quota management

### 📝 Planned Features
- User upload interface
- Mobile client implementation
- Admin dashboard UI
- User management interface

## Current Architecture

```mermaid
flowchart LR
    %% mobile clients
    subgraph Mobile["mobile app"]
        style Mobile fill:#1e1e1e,stroke:#444,color:#ddd
        UA["Space User"]
        AA["Space Admin"]
    end

    %% token service
    subgraph TokenSvc["token-svc"]
        style TokenSvc fill:#282828,stroke:#666,color:#ddd
        API["API"]
        KV["Key vault"]
        SDK["@web3-storage/w3up-client"]
        Session["Session Store"]
        Cache["Space Cache"]
        API --> KV
        API --> SDK
        API --> Session
        API --> Cache
    end

    %% storacha storage
    subgraph Storacha["storacha storage"]
        style Storacha fill:#181818,stroke:#555,color:#ddd
        BR["HTTP API bridge"]
        DB["Storage"]
        BR --> DB
    end

    %% flows
    AA -- "POST /auth/login/:email" --> API
    AA -- "POST /spaces/import" --> API
    AA -- "POST /spaces/delegate" --> API
    UA -- "POST /token" --> API
    API -- "token + delegation" --> UA
    UA -- "CAR + headers" --> BR
```

## API Endpoints

### Authentication
- `POST /auth/login/:email` - Admin login with email (w3up protocol)
- `GET /auth/session` - Validate session
- `POST /auth/logout` - Clear session
- `POST /auth/w3up/logout` - Logout from w3up service

### Spaces
- `GET /spaces` - List spaces for authenticated admin
- `POST /spaces/import` - Import a space
- `POST /spaces/delegate` - Delegate user permissions
- `GET /spaces/usage` - Get space usage information (requires spaceDid query parameter and admin authentication)

### Upload Paths
There are two ways to upload files:

1. **Direct Upload via w3up HTTP API Bridge** (🚧 In Progress)
   ```bash
   # 1. Get authentication tokens for the bridge (Currently requires additional work)
   curl -H "x-user-did: your-user-did" \
     "http://localhost:3000/bridge-tokens?spaceDid=your-space-did"
   
   # Note: The bridge-tokens endpoint currently needs additional work to properly
   # handle space/blob/add capabilities. For now, use the proxy upload path below.
   
   # 2. Use tokens to upload directly to w3up HTTP API bridge
   curl -X POST \
     -H "X-Auth-Secret: token-from-bridge-tokens" \
     -H "Authorization: auth-from-bridge-tokens" \
     -F "file=@/path/to/file.png" \
     https://up.storacha.network/bridge
   ```

2. **Upload through Token Service** (✅ Working)
   ```bash
   # Upload through the token service (Recommended for now)
   curl -X POST \
     -H "x-user-did: your-user-did" \
     -F "file=@/path/to/file.png" \
     -F "spaceDid=your-space-did" \
     http://localhost:3000/upload
   ```

   This endpoint:
   - Validates user delegation
   - Handles file uploads securely
   - Manages temporary files
   - Provides proper error handling
   - Currently supports all required capabilities for uploads

### Delegations
- `GET /delegations/user/spaces` - List spaces accessible to a user
- `GET /delegations/list` - List delegations (admin only, requires session)
- `POST /delegations/create` - Create a delegation (admin only, requires session)
- `GET /delegations/get` - Get delegation details for a specific space
- `DELETE /delegations/revoke` - Revoke a delegation (admin only, requires session)
  ```bash
  # Revoke all delegations for a user in a space
  curl -X DELETE \
    -H "x-session-id: your-session-id" \
    -H "Content-Type: application/json" \
    -d '{
      "userDid": "did:key:user-did-here",
      "spaceDid": "did:key:space-did-here"
    }' \
    http://localhost:3000/delegations/revoke

  # Success Response (200):
  {
    "message": "Delegations revoked successfully",
    "userDid": "did:key:...",
    "spaceDid": "did:key:...",
    "revokedCount": 1
  }

  # Error Responses:
  # 400 - Missing required fields
  {
    "message": "userDid and spaceDid are required"
  }
  
  # 404 - No active delegation found
  {
    "message": "No active delegation found for this user and space"
  }
  
  # 500 - Server error
  {
    "message": "Failed to revoke delegations"
  }
  ```

### Storage
- `GET /spaces/usage` - Get space usage information (requires spaceDid query parameter and admin authentication)
  ```bash
  # Example response:
  {
    "spaceDid": "did:key:your-space-did",
    "usage": {
      "bytes": 11744,
      "mb": 0.0112,
      "human": "0.0112 MB"
    }
  }
  ```

### Account Usage (Admin)
- `GET /spaces/account-usage` - Get total storage usage across all spaces for the authenticated admin
  - **Required header:** `x-session-id` (admin session ID)
  - **Description:** Returns the total storage usage for all spaces owned by the admin, as well as per-space usage breakdown.
  - **Example:**
    ```bash
    curl -H "x-session-id: your-session-id" \
      http://localhost:3000/spaces/account-usage
    ```
    **Example response:**
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
        },
        // ... more spaces ...
      ]
    }
    ```

## Development Setup

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

The server runs on port 3000 by default. Set the `PORT` environment variable to change this.

## Dependencies

- `@web3-storage/w3up-client` - Web3.Storage client for w3up protocol
- `@ipld/car` - Content Addressable aRchive handling
- `@ucanto/core` - UCAN protocol implementation
- `express` - Web server framework
- `cors` - Cross-origin resource sharing

## Sequence diagram
```mermaid
sequenceDiagram
    autonumber
    participant AdminApp
    participant TokenSvc
    participant Bridge
    participant Storage
    participant UserApp

    rect rgb(46,46,46)
        note over AdminApp,TokenSvc: bootstrap space
        AdminApp->>TokenSvc: POST /auth/login/:email
        TokenSvc-->>AdminApp: 202 Accepted
        Note over AdminApp,TokenSvc: Email confirmation
        AdminApp->>TokenSvc: POST /spaces/import
        TokenSvc-->>AdminApp: 201 CREATED
    end

    rect rgb(36,36,36)
        note over AdminApp,TokenSvc: delegate user
        AdminApp->>TokenSvc: POST /spaces/delegate
        TokenSvc-->>AdminApp: {delegationCid}
    end

    rect rgb(26,26,26)
        note over UserApp,Bridge: normal upload
        UserApp ->> TokenSvc: POST /token
        TokenSvc-->>UserApp: {token, delegation}
        UserApp ->> Bridge: POST /upload (CAR + headers)
        Bridge  ->> Storage: persist blocks
        Bridge  -->> UserApp: 200 / receipt
    end
```

## User journeys

### Admin journey
1. Creates an account on Storacha
2. Logs in with email and DID (w3up protocol)
   - First time: Provides both email and DID
   - Subsequent logins: Can use either email+DID or just DID
3. Imports or creates space
4. Delegates upload capabilities to users

### User journey
1. App generates keypair + DID
2. User copies DID and sends to admin
3. Admin delegates permissions
4. User receives token for uploads
5. User can:
   - List their accessible spaces using `/delegations/user/spaces`
   - Upload files using:
     - Their DID in x-user-did header
     - Space DID in the request
     - File in multipart form data
     - Proper delegation token

## Journey: From Login to Upload

This section documents the step-by-step process of logging in as an admin, listing spaces, delegating permissions, and uploading files.

### 1. Start the Server
```bash
npm run start
```
The server will start on port 3000 by default.

### 2. Admin Login
```bash
# First time login with email and DID
curl -X POST -H "Content-Type: application/json" \
  -d '{
    "email": "your-email@example.com",
    "did": "did:key:your-did-here"
  }' \
  http://localhost:3000/auth/login/email

# Subsequent login with DID only
curl -X POST -H "Content-Type: application/json" \
  -d '{
    "did": "did:key:your-did-here"
  }' \
  http://localhost:3000/auth/login/did

# Response will include a sessionId
# {"message":"Login successful","sessionId":"your-session-id","did":"did:key:..."}

# Verify session is valid
curl -H "x-session-id: your-session-id" \
  http://localhost:3000/auth/session

# Response should confirm session validity
# {"valid":true,"expiresAt":"2024-03-21T12:00:00.000Z","message":"Session is valid"}
```

### 3. List Available Spaces
```bash
# List all spaces accessible to the admin
curl -H "x-session-id: your-session-id" \
  http://localhost:3000/spaces

# Response will be an array of spaces with their DIDs and names
# [
#   {"did":"did:key:...","name":"space-name"},
#   ...
# ]
```

### 4. Create Delegation
```bash
# Create a delegation for a user to a specific space
curl -X POST -H "x-session-id: your-session-id" \
  -H "Content-Type: application/json" \
  -d '{
    "userDid": "did:key:user-did-here",
    "spaceDid": "did:key:space-did-here"
  }' \
  http://localhost:3000/delegations/create

# Response will include delegation details
# {
#   "message": "Delegation created successfully",
#   "principalDid": "did:key:...",
#   "delegationCid": "bafy...",
#   "expiresAt": "2025-..."
# }
```

### 5. Upload File to Space
```bash
# Upload a file using the delegation
curl -X POST \
  -H "x-user-did: your-user-did" \
  -F "file=@/path/to/your/file.png" \
  -F "spaceDid=did:key:your-space-did" \
  http://localhost:3000/upload

# Response will include the CID and size of the uploaded file
# {
#   "success": true,
#   "cid": "bafkreige7hs3pe3d2h3o5a2l2hfrbaafmb7anoxwszuyamhazoanygwebe",
#   "size": 11744,
#   "carCid": "bafy..."
# }

# Check space usage
curl -H "x-session-id: your-session-id" \
  "http://localhost:3000/spaces/usage?spaceDid=did:key:your-space-did"

# Response will show current space usage
# {
#   "spaceDid": "did:key:your-space-did",
#   "usage": {
#     "bytes": 11744,
#     "mb": 0.0112,
#     "human": "0.0112 MB"
#   }
# }
```

### Notes
- The `userDid` is the DID of the user who will be uploading files
- The `spaceDid` is the DID of the space where files will be uploaded
- The session ID from login must be used for admin operations (listing spaces, creating delegations)
- The user's DID must be used for upload operations
- Delegations expire after 24 hours by default

## Implementation Details

### Token Service
- Express.js backend
- Session management with 24-hour expiry
- Space caching for performance
- W3up client persistence
- Admin Service DID (ASSD) management

### Storage Bridge (Planned)
- HTTP API for file uploads
- CAR file generation
- Upload progress tracking
- Storage quota management
- Error handling and retries

## UI Components

### Admin view
- Email input for w3up login
- Space management interface
- User delegation interface
- Space usage dashboard

### User view
- DID display and copy
- Upload interface
- Upload status tracking
- Storage quota display

## Complete Example: Delegation and Upload

Here's a complete example of the delegation and upload process using real DIDs and responses:

### 1. Admin Login
```bash
# Login with email and DID
curl -X POST -H "Content-Type: application/json" \
  -d '{
    "email": "admin@email.net",
    "did": "did:key:z6MkujSWEBZStjaPYidedRXqWD3iNgkZuqBm32zHVbgSDJsY"
  }' \
  http://localhost:3000/auth/login/email

# Response:
{
  "message": "Login successful",
  "sessionId": "c0035bba684a603a18c4aa2f548e32ff",
  "did": "did:key:z6MkujSWEBZStjaPYidedRXqWD3iNgkZuqBm32zHVbgSDJsY"
}
```

### 2. List Spaces
```bash
# List available spaces
curl -H "x-session-id: c0035bba684a603a18c4aa2f548e32ff" \
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

### 3. Create Delegation
```bash
# Create delegation for a user
curl -X POST -H "x-session-id: c0035bba684a603a18c4aa2f548e32ff" \
  -H "Content-Type: application/json" \
  -d '{
    "userDid": "did:key:z6Mknq1W5c3fRyry4vgw9VUitFJQZ1p9CyA9BBPyju9QHvAr",
    "spaceDid": "did:key:z6MkfUhCYVDxnnpw47uDESen3xhg5pYDY1SChD2TuxdEUHWA"
  }' \
  http://localhost:3000/delegations/create

# Response:
{
  "message": "Delegation created successfully",
  "principalDid": "did:key:z6Mkmr5cq8AX2fMZ4zoUAuHayLGwLnRkTksgqXGRVKwg7gGb",
  "delegationCid": "bafyreihbbauer7b5qp4o32b76ollcu4phesghoueyduqbf232hqsy4atjy",
  "expiresAt": "2025-06-06T17:48:53.116Z"
}
```

### 4. Verify User's Access
```bash
# Check spaces accessible to the user
curl -H "x-user-did: did:key:z6Mknq1W5c3fRyry4vgw9VUitFJQZ1p9CyA9BBPyju9QHvAr" \
  http://localhost:3000/delegations/user/spaces

# Response:
{
  "userDid": "did:key:z6Mknq1W5c3fRyry4vgw9VUitFJQZ1p9CyA9BBPyju9QHvAr",
  "spaces": ["did:key:z6MkfUhCYVDxnnpw47uDESen3xhg5pYDY1SChD2TuxdEUHWA"],
  "expiresAt": "2025-06-06T17:48:53.116Z"
}
```

### 5. Upload File
```bash
# Create a test file
echo "Hello June 5 2025 13:49 Eastern time!" > test-file.txt

# Upload the file
curl -X POST \
  -H "x-user-did: did:key:z6Mknq1W5c3fRyry4vgw9VUitFJQZ1p9CyA9BBPyju9QHvAr" \
  -F "file=@test-file.txt" \
  -F "spaceDid=did:key:z6MkfUhCYVDxnnpw47uDESen3xhg5pYDY1SChD2TuxdEUHWA" \
  http://localhost:3000/upload

# Response:
{
  "success": true,
  "cid": "bafkreibkchotcmrno56vb3vw7gdkxq7c2sixqswsvj7iq2e57f55trfnuu",
  "size": 38
}
```

### 6. Check Space Usage
```bash
# Check space usage as admin
curl -H "x-session-id: c0035bba684a603a18c4aa2f548e32ff" \
  "http://localhost:3000/spaces/usage?spaceDid=did:key:z6MkfUhCYVDxnnpw47uDESen3xhg5pYDY1SChD2TuxdEUHWA"

# Response:
{
  "spaceDid": "did:key:z6MkfUhCYVDxnnpw47uDESen3xhg5pYDY1SChD2TuxdEUHWA",
  "usage": {
    "bytes": 12256,
    "mb": 0.0117,
    "human": "0.0117 MB"
  }
}
```

This example demonstrates:
- Complete admin login flow
- Space listing
- Delegation creation with real DIDs
- Verification of user access
- File upload with delegation
- Usage monitoring

The delegation grants the user access to the space until the expiration date (in this case, June 6th, 2025). The user can upload files to the space using their DID in the `x-user-did` header.

## Complete Example: Revoking a Delegation

Here's a complete example of revoking a user's access to a space:

### 1. Verify Current Access
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

### 2. Revoke the Delegation
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

### 3. Verify Access is Revoked
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

### 4. Verify Upload is Blocked
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
