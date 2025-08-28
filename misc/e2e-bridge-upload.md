# End-to-End Bridge Upload Workflow Documentation

## Overview

This document describes the complete end-to-end workflow for uploading files to Storacha using the bridge API. The workflow involves generating bridge tokens, creating CAR files, uploading to S3, and registering the upload with Storacha.

## Prerequisites

- Server running on port 3000
- Valid admin session OR valid delegated user DID
- `ipfs-car` tool installed
- `curl` for API calls
- Valid space DID for upload target

## Complete Workflow for bridge uploads

### 1. Server Setup

Ensure the server is running with bridge routes mounted at root level:

```bash
# Start server
npm start
```

**Key Configuration**: Bridge routes are mounted at root level (`/`) so endpoints are accessible as `/bridge-tokens` directly.

### 2. Authentication

**Option A: Admin Authentication**
**Option B: Delegated User Authentication**

### 3. File Preparation

Convert the file to CAR format:

```bash
# Create test file


# Create CAR file
ipfs-car pack test-file.txt > test-file.car

# Get CAR CID (bag...)
ipfs-car hash test-file.car

# Get file size
wc -c test-file.car
```

### 4. Generate Bridge Tokens

Generate bridge tokens for the target space:

**Option A: Admin Authentication (using session ID)**
```bash
curl -X POST http://localhost:3000/bridge-tokens \
  -H "x-session-id: your-session-id" \
  -H "Content-Type: application/json" \
  -d '{
    "resource": "did:key:z6MyourTargetSPACEDIDasadalkdjas",
    "can": ["store/add", "upload/add"],
    "expiration": expirationTime,
    "json": false
  }'
```

**Option B: Delegated User Authentication (using user DID)**
```bash
curl -X POST http://localhost:3000/bridge-tokens \
  -H "x-user-did: did:key:z6MkdelegatedUserDID..." \
  -H "Content-Type: application/json" \
  -d '{
    "resource": "did:key:z6MyourTargetSPACEDIDasadalkdjas",
    "can": ["store/add", "upload/add"],
    "expiration": expirationTime,
    "json": false
  }'
```

**Expected Response**:
```json
{
  "success": true,
  "tokens": {
    "xAuthSecret": "uODV-x-auth-secret-example",
    "authorization": "uOqAuthorizationHeadersSample-cHutxvuHS4JrNQt8mIloDEnHE8IPKIh2Qh..."
  }
}
```

### 5. Call Bridge API (store/add)

Request storage allocation and S3 pre-signed URL:

```bash
curl -X POST https://up.storacha.network/bridge \
  -H "X-Auth-Secret: uODV-x-auth-secret-example" \
  -H "Authorization: uOqAuthorizationHeadersSample-cHutxvuHS4JrNQt8mIloDEnHE8IPKIh2Qh..." \
  -H "Content-Type: application/json" \
  -d '{
    "tasks": [
      [
        "store/add",
        "did:key:z6MyourTargetSPACEDIDasadalkdjas",
        {
          "link": { "/": "bagbasampleCARCIDdlasdlaskjdasldkja" },
          "size": 550
        }
      ]
    ]
  }'
```

**Expected Response**:
```json
[{
  "p": {
    "out": {
      "ok": {
        "status": "upload",
        "url": "https://carpark-prod-0.s3.us-west-2.amazonaws.com/...",
        "headers": {
          "content-length": "550",
          "x-amz-checksum-sha256": "WDi2HyhOXtchMzfz84srJUygSOIvhLsqSVvH3pFlQdw="
        }
      }
    }
  }
}]
```

**Important**: 
- If `status` is `"done"`, the file is already uploaded. If `status` is `"upload"`, proceed to S3 upload.
- **Note**: The `shards` field in `store/add` is NOT required for small uploads.

### 6. Upload to S3

Upload the CAR file to the provided S3 URL:

```bash
curl -v -X PUT \
  -H "content-length: 550" \
  -H "x-amz-checksum-sha256: WDi2HyhOXtchMzfz84srJUygSOIvhLsqSVvH3pFlQdw=" \
  --data-binary @test-bridge-e2e.car \
  "https://carpark-prod-0.s3.us-west-2.amazonaws.com/..."
```

**Expected Response**: `HTTP/1.1 200 OK`

**Note**: S3 pre-signed URLs expire quickly. If you get `InvalidToken`, regenerate tokens and try again immediately.

### 7. Register Upload (upload/add)

Register the upload with Storacha:

```bash
curl -X POST https://up.storacha.network/bridge \
  -H "X-Auth-Secret: uODV-x-auth-secret-example" \
  -H "Authorization: uOqAuthorizationHeadersSample-cHutxvuHS4JrNQt8mIloDEnHE8IPKIh2Qh..." \
  -H "Content-Type: application/json" \
  -d '{
    "tasks": [
      [
        "upload/add",
        "did:key:z6MyourTargetSPACEDIDasadalkdjas",
        {
          "root": { "/": "bafybeidyzsampleRootDAGCIDsadalskdjadasda" }
        }
      ]
    ]
  }'
```

**Expected Response**:
```json
[{
  "p": {
    "out": {
      "ok": {
        "root": { "/": "bafybeidyzsampleRootDAGCIDsadalskdjadasda" },
        "shards": []
      }
    }
  }
}]
```

## Key Insights

### Bridge Token Generation

- **Endpoint**: `/bridge-tokens` (mounted at root level)
- **Authentication**: 
  - **Admin**: Requires valid session ID in `x-session-id` header
  - **Delegated User**: Requires valid user DID in `x-user-did` header
- **Token Format**: Returns `xAuthSecret` and `authorization` headers
- **Expiration**: Tokens expire quickly, regenerate as needed
- **Delegation Support**: Automatically handles UCAN delegation chains for delegated users

### S3 Upload Challenges

- **Short Expiration**: Pre-signed URLs expire very quickly (minutes)
- **Immediate Upload**: Must upload immediately after getting URL
- **Retry Strategy**: If upload fails, regenerate tokens and try again
- **Headers**: Use exact headers provided by bridge response

### File Format Requirements

- **CAR Files**: Must use Content Addressable Archive format
- **CID Types**: 
  - Root DAG CID: `bafy...` (for upload/add)
  - CAR CID: `bag...` (for store/add)
- **Size Calculation**: Use `wc -c` for exact byte count

### Critical Capability Structure

- **`store/add`**: Must include `link` and `size` (shards field NOT required for small uploads)
- **`upload/add`**: Must NOT include `shards` field (causes authorization errors)
- **Space DID**: Must use space DID from spaces list
- **Token Freshness**: Tokens expire quickly, failures might require to regenerate fresh tokens for each test

**Note on Shards Field**: only `link` and `size` are needed in `store/add`. The `shards` field is only required for large, multi-part uploads.

### Error Handling

- **InvalidToken**: Regenerate tokens and retry immediately
- **Session Expired**: Re-login to get new session ID
- **S3 Errors**: Check URL expiration and retry with fresh tokens

## Troubleshooting

### Common Issues

1. **"Cannot POST /bridge-tokens"**
   - Check server is running
   - Verify bridge routes are mounted at root level

2. **"InvalidToken" on S3 upload**
   - Pre-signed URL expired
   - Regenerate tokens and upload immediately

3. **"Session not verified"**
   - Re-login to get fresh session
   - Ensure DID verification completed

4. **"Claim not authorized"**
   - Check admin has proper delegations for the space
   - Verify space DID is correct

5. **"could not extract delegation from authorization header value"**
   - Tokens have expired (most common cause)
   - Generate fresh tokens and retry immediately

