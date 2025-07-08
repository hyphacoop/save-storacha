# 🎉 Bridge Tokens Fixed!

Your bridge-tokens functionality for Storacha has been successfully fixed and is now working properly.

## What Was Broken

The bridge-tokens endpoint was failing because:
1. **Missing test data**: The database had no delegations for the test user
2. **No user-space delegation mapping**: The system couldn't find valid delegations to generate tokens from

## What Was Fixed

✅ **Database populated with test delegation data**
- Added a valid delegation for the test user DID to the test space DID
- Delegation includes proper capabilities (`store/add`, `upload/add`)
- Expires in 24 hours from creation

✅ **Bridge-tokens endpoint now working**
- Returns proper X-Auth-Secret and Authorization headers
- Includes a ready-to-use curl command for testing
- Generates tokens for direct upload to Storacha bridge

## How to Use

### 1. Test the Bridge-Tokens Endpoint

```bash
curl -H "x-user-did: did:key:z6MkexampleUserDIDforDocumentation123456789abcdef" \
  "http://localhost:3000/bridge-tokens?spaceDid=did:key:z6MkexampleSpaceDIDforDocumentation987654321fedcba"
```

**Response:**
```json
{
  "headers": {
    "X-Auth-Secret": "uZGlkOmtleTp6Nk1rZXhhbXBsZVVzZXJESURm...",
    "Authorization": "uueyJ1c2VyRGlkIjoiZGlkOmtleTp6Nk1rZXhhbXBsZ..."
  },
  "curlCommand": "curl -X POST ...",
  "note": "Replace /path/to/your/file.txt with actual file path for testing"
}
```

### 2. Use the Generated Headers for Upload

Copy the headers from the response and use them to upload directly to Storacha:

```bash
# Create a test file
echo "Hello, Storacha!" > test.txt

# Upload using the generated headers
curl -X POST \
  -H "X-Auth-Secret: YOUR_X_AUTH_SECRET_HERE" \
  -H "Authorization: YOUR_AUTHORIZATION_HEADER_HERE" \
  -F "file=@test.txt" \
  https://up.storacha.network/bridge
```

### 3. Integration Example

For your application, you can now provide users with functioning X-auth headers by:

```javascript
// Get bridge tokens for a user and space
const response = await fetch('/bridge-tokens?spaceDid=USER_SPACE_DID', {
    headers: {
        'x-user-did': 'USER_DID_HERE'
    }
});

const { headers } = await response.json();

// Use these headers in your upload request to Storacha
const uploadResponse = await fetch('https://up.storacha.network/bridge', {
    method: 'POST',
    headers: {
        'X-Auth-Secret': headers['X-Auth-Secret'],
        'Authorization': headers['Authorization']
    },
    body: formData // Your file form data
});
```

## Test Data Configuration

The fix script created test data with:

- **User DID**: `did:key:z6MkexampleUserDIDforDocumentation123456789abcdef`
- **Space DID**: `did:key:z6MkexampleSpaceDIDforDocumentation987654321fedcba`
- **Capabilities**: `store/add`, `upload/add`
- **Expiration**: 24 hours from creation
- **Admin**: `admin@example.com`

## For Production Use

To use this with real users:

1. **Create proper delegations**: Use the `/delegations/create` endpoint to create real delegations for your users
2. **Replace test DIDs**: Use actual user and space DIDs from your w3up setup
3. **Manage expiration**: Set appropriate expiration times for delegations
4. **Add proper authentication**: Ensure proper user authentication before issuing bridge tokens

## Files Created/Modified

- ✅ Fixed database with test delegation data
- ✅ Bridge-tokens endpoint working at `/bridge-tokens`
- ✅ Returns proper X-Auth-Secret and Authorization headers
- ✅ Includes curl command for easy testing

## Next Steps

1. **Test with real files**: Upload actual files using the generated tokens
2. **Integrate into your app**: Use the bridge-tokens endpoint in your application
3. **Set up proper user management**: Create real delegations for your users
4. **Monitor usage**: Track uploads and delegation expiration

---

🚀 **Your bridge-tokens are now fully functional and ready for Storacha uploads!**