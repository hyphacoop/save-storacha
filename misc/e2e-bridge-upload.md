# End-to-End Bridge Upload Workflow Documentation

## Overview

This document describes the complete end-to-end workflow for uploading files to Storacha using the bridge API. The workflow involves generating bridge tokens, creating CAR files, uploading to S3, and registering the upload with Storacha.

## Prerequisites

- Server running on port 3000
- Valid admin session with delegations loaded
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

Login to obtain a session ID:


### 3. File Preparation

Create a test file and convert it to CAR format:

```bash
# Create test file


# Create CAR file
ipfs-car pack test-file.txt > test-file.car

# Get CAR CID (bag...)
ipfs-car hash test-file.car

# Get file size
wc -c test-file.car
```

**Expected Output**:
- CAR CID: `bagbasampleCARCIDdlasdlaskjdasldkja`
- Size: `550` bytes
- Root DAG CID: `bafybeidyzsampleRootDAGCIDsadalskdjadasda`

### 4. Generate Bridge Tokens

Generate bridge tokens for the target space:

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

**Important**: If `status` is `"done"`, the file is already uploaded. If `status` is `"upload"`, proceed to S3 upload.

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
          "root": { "/": "bafybeidyzsampleRootDAGCIDsadalskdjadasda" },
          "shards": [{ "/": "bagbasampleCARCIDdlasdlaskjdasldkja" }]
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
        "shards": [{ "/": "bagbasampleCARCIDdlasdlaskjdasldkja" }]
      }
    }
  }
}]
```

## Key Insights

### Bridge Token Generation

- **Endpoint**: `/bridge-tokens` (mounted at root level)
- **Authentication**: Requires valid session ID in `x-session-id` header
- **Token Format**: Returns `xAuthSecret` and `authorization` headers
- **Expiration**: Tokens expire quickly, regenerate as needed

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

### Error Handling

- **InvalidToken**: Regenerate tokens and retry immediately
- **Session Expired**: Re-login to get new session ID
- **S3 Errors**: Check URL expiration and retry with fresh tokens

## Success Criteria

✅ **Server Running**: Bridge routes accessible at `/bridge-tokens`  
✅ **Authentication**: Valid session with loaded delegations  
✅ **Token Generation**: Successfully generated bridge tokens  
✅ **Bridge API**: Successfully called `store/add` and got S3 URL  
✅ **S3 Upload**: Successfully uploaded CAR file (HTTP 200)  
✅ **Upload Registration**: Successfully called `upload/add`  
✅ **File Available**: File appears in Storacha account upload list  

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

### Debug Commands

```bash
# Verify session status
curl -H "x-session-id: YOUR_SESSION_ID" http://localhost:3000/auth/session

# Test bridge tokens endpoint
curl -X POST http://localhost:3000/bridge-tokens \
  -H "x-session-id: YOUR_SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{"resource": "YOUR_SPACE_DID"}'


```

alternatively, check server logs to see what failed. send bugs to maintainers or open an issue documenting the failure

## Conclusion

This end-to-end workflow successfully demonstrates:

1. **Bridge token generation** using admin delegations
2. **CAR file creation** and CID extraction
3. **S3 pre-signed URL** acquisition and upload
4. **Upload registration** with Storacha
5. **Complete file lifecycle** from local file to Storacha storage

The bridge token system should be working correctly and can handle the complete file upload workflow from start to finish. 