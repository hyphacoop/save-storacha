# Mobile Development Guide

This guide provides code snippets for mobile app developers to integrate with the save-storacha service.

## DID Generation

### Swift (iOS)

```swift
import Foundation
import CryptoKit

// You'll need to add a DID library like 'DIDKit' or implement the DID format
// This is a simplified example showing the concept

func generateUserDID() -> String {
    // Generate Ed25519 keypair
    let privateKey = Curve25519.Signing.PrivateKey()
    let publicKey = privateKey.publicKey
    
    // Convert to raw bytes
    let publicKeyData = publicKey.rawRepresentation
    
    // Create multibase encoding (base58btc)
    let multibase = "z" + base58Encode(publicKeyData)
    
    // Create DID
    let did = "did:key:" + multibase
    
    return did
}

// Helper function for base58 encoding (you'll need to implement this)
func base58Encode(_ data: Data) -> String {
    // Implementation needed - use a library like 'Base58Swift'
    // This is just a placeholder
    return ""
}
```

### Kotlin (Android)

```kotlin
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.SecureRandom
import java.security.spec.EdECPublicKeySpec
import java.security.spec.NamedParameterSpec

// You'll need to add a DID library or implement the DID format
// This is a simplified example showing the concept

fun generateUserDID(): String {
    // Generate Ed25519 keypair
    val keyPairGenerator = KeyPairGenerator.getInstance("Ed25519")
    keyPairGenerator.initialize(Ed25519ParameterSpec(), SecureRandom())
    val keyPair: KeyPair = keyPairGenerator.generateKeyPair()
    
    // Get public key bytes
    val publicKey = keyPair.public
    val publicKeyBytes = publicKey.encoded
    
    // Create multibase encoding (base58btc)
    val multibase = "z" + base58Encode(publicKeyBytes)
    
    // Create DID
    val did = "did:key:$multibase"
    
    return did
}

// Helper function for base58 encoding (you'll need to implement this)
fun base58Encode(data: ByteArray): String {
    // Implementation needed - use a library like 'Base58'
    // This is just a placeholder
    return ""
}
```

## CAR File Generation

CAR (Content Addressable aRchive) files are the standard format for uploading files to IPFS-based storage systems like Storacha. This section shows how to convert any file into a CAR file before uploading.

### What is a CAR File?

A CAR file is a binary format that contains:
- **Header**: Version and root CID information
- **Blocks**: IPLD blocks containing the file data
- **Index**: Block locations within the file

### Swift (iOS)

```swift
import Foundation
import CryptoKit

// You'll need to add IPFS/CAR libraries like 'ipfs-car-swift' or implement CAR format
// This is a simplified example showing the concept

func createCarFile(from fileURL: URL) throws -> Data {
    // Read the file data
    let fileData = try Data(contentsOf: fileURL)
    
    // Create IPLD block from file data
    let block = try createIPLDBlock(from: fileData)
    
    // Create CAR file structure
    let carData = try createCARFile(rootCID: block.cid, blocks: [block])
    
    return carData
}

// Helper function to create IPLD block
func createIPLDBlock(from data: Data) throws -> IPLDBlock {
    // Implementation needed - use a library like 'ipfs-car-swift'
    // This would create a proper IPLD block with CID
    fatalError("Implementation needed")
}

// Helper function to create CAR file
func createCARFile(rootCID: String, blocks: [IPLDBlock]) throws -> Data {
    // Implementation needed - use a library like 'ipfs-car-swift'
    // This would create the CAR file format
    fatalError("Implementation needed")
}

// Usage example
do {
    let fileURL = URL(fileURLWithPath: "/path/to/your/file.txt")
    let carData = try createCarFile(from: fileURL)
    
    // Save CAR file
    let carURL = fileURL.appendingPathExtension("car")
    try carData.write(to: carURL)
    
    print("CAR file created: \(carURL.path)")
} catch {
    print("Error creating CAR file: \(error)")
}
```

### Kotlin (Android)

```kotlin
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.security.MessageDigest

// You'll need to add IPFS/CAR libraries like 'ipfs-car-kotlin' or implement CAR format
// This is a simplified example showing the concept

fun createCarFile(filePath: String): ByteArray {
    val file = File(filePath)
    val fileData = file.readBytes()
    
    // Create IPLD block from file data
    val block = createIPLDBlock(fileData)
    
    // Create CAR file structure
    val carData = createCARFile(rootCID = block.cid, blocks = listOf(block))
    
    return carData
}

// Helper function to create IPLD block
fun createIPLDBlock(data: ByteArray): IPLDBlock {
    // Implementation needed - use a library like 'ipfs-car-kotlin'
    // This would create a proper IPLD block with CID
    throw NotImplementedError("Implementation needed")
}

// Helper function to create CAR file
fun createCARFile(rootCID: String, blocks: List<IPLDBlock>): ByteArray {
    // Implementation needed - use a library like 'ipfs-car-kotlin'
    // This would create the CAR file format
    throw NotImplementedError("Implementation needed")
}

// Usage example
try {
    val filePath = "/path/to/your/file.txt"
    val carData = createCarFile(filePath)
    
    // Save CAR file
    val carFilePath = "$filePath.car"
    File(carFilePath).writeBytes(carData)
    
    println("CAR file created: $carFilePath")
} catch (e: Exception) {
    println("Error creating CAR file: ${e.message}")
}
```

## Upload Process

### Step 1: Generate DID
```swift
// iOS
let userDID = generateUserDID()
print("User DID: \(userDID)")
```

```kotlin
// Android
val userDID = generateUserDID()
println("User DID: $userDID")
```

### Step 2: Get Auth Tokens
Make an HTTP request to get authentication tokens:

```swift
// iOS
let url = URL(string: "https://your-token-service.com/bridge-tokens?spaceDid=YOUR_SPACE_DID")!
var request = URLRequest(url: url)
request.setValue(userDID, forHTTPHeaderField: "x-user-did")

let (data, _) = try await URLSession.shared.data(for: request)
let response = try JSONDecoder().decode(AuthResponse.self, from: data)
```

```kotlin
// Android
val url = "https://your-token-service.com/bridge-tokens?spaceDid=YOUR_SPACE_DID"
val client = OkHttpClient()
val request = Request.Builder()
    .url(url)
    .addHeader("x-user-did", userDID)
    .build()

val response = client.newCall(request).execute()
val authResponse = JSONObject(response.body?.string() ?: "")
```

### Step 3: Create CAR File
```swift
// iOS
let fileURL = URL(fileURLWithPath: "/path/to/your/file.txt")
let carData = try createCarFile(from: fileURL)
```

```kotlin
// Android
val filePath = "/path/to/your/file.txt"
val carData = createCarFile(filePath)
```

### Step 4: Upload to Bridge
```swift
// iOS
let uploadURL = URL(string: "https://up.storacha.network/bridge")!
var uploadRequest = URLRequest(url: uploadURL)
uploadRequest.httpMethod = "POST"
uploadRequest.setValue("application/vnd.ipld.car", forHTTPHeaderField: "Content-Type")
uploadRequest.setValue(response.headers["X-Auth-Secret"], forHTTPHeaderField: "X-Auth-Secret")
uploadRequest.setValue(response.headers["Authorization"], forHTTPHeaderField: "Authorization")
uploadRequest.httpBody = carData

let (uploadData, _) = try await URLSession.shared.data(for: uploadRequest)
let uploadResponse = try JSONDecoder().decode(UploadResponse.self, from: uploadData)
print("Upload successful! CID: \(uploadResponse.cid)")
```

```kotlin
// Android
val uploadURL = "https://up.storacha.network/bridge"
val uploadRequest = Request.Builder()
    .url(uploadURL)
    .post(carData.toRequestBody("application/vnd.ipld.car".toMediaType()))
    .addHeader("X-Auth-Secret", authResponse.getString("X-Auth-Secret"))
    .addHeader("Authorization", authResponse.getString("Authorization"))
    .build()

val uploadResponse = client.newCall(uploadRequest).execute()
val uploadResult = JSONObject(uploadResponse.body?.string() ?: "")
println("Upload successful! CID: ${uploadResult.getString("cid")}")
```

## CAR File Format Explanation

### Structure
```
[Header] [Block 1] [Block 2] ... [Block N]
```

### Header Format
- **Version**: 1 byte (0x01)
- **Roots**: Variable-length array of CIDs
- **Length**: Total header length

### Block Format
- **Length**: 4 bytes (block size)
- **CID**: Variable-length CID
- **Data**: Block content

### Key Requirements

- **Content-Type**: `application/vnd.ipld.car`
- **File Extension**: `.car`
- **CID Format**: IPFS CID v1 (base32)
- **Block Size**: Variable (typically 1MB max)

### Important Notes

1. **Content Addressable**: CAR files are identified by their CID
2. **Self-contained**: All necessary blocks are included
3. **Streamable**: Can be processed without loading entire file
4. **Standard Format**: Compatible with all IPFS implementations

### Dependencies

For production use, consider these libraries:

- **Swift**: `ipfs-car-swift`, `multiformats-swift`
- **Kotlin**: `ipfs-car-kotlin`, `multiformats-kotlin`

## DID Format Explanation

The DID format used is `did:key:` which is a simple, self-contained DID method:

- **Format**: `did:key:z6Mk...`
- **Prefix**: `did:key:` indicates this is a key-based DID
- **Multibase**: `z` indicates base58btc encoding
- **Key Type**: The remaining characters encode the public key

### Key Requirements

- **Algorithm**: Ed25519 (recommended for mobile apps)
- **Encoding**: Multibase base58btc
- **Format**: `did:key:z6Mk...`

### Important Notes

1. **Deterministic**: The same private key will always generate the same DID
2. **Portable**: DIDs can be shared between devices and platforms
3. **Self-contained**: No external registry needed
4. **Secure**: Uses cryptographic keypairs for authentication

### Dependencies

For production use, consider these libraries:

- **Swift**: `DIDKit`, `Base58Swift`
- **Kotlin**: `did:key`, `Base58`

### Next Steps

Once you have generated a DID and can create CAR files, you can:

1. **For Admins**: Use the DID to log in to the token service
2. **For Users**: Share the DID with an admin for delegation
3. **For Uploads**: Use the DID for authentication with the bridge API
4. **For Files**: Convert any file to CAR format and upload directly 


## DID-Based Authentication

This section outlines how to authenticate using a `did:key` identity. The server will return a challenge string after login and the client signs with their Ed25519 private key.

### Auth Flow Overview

1. **Client sends** `POST /auth/login/` with `x-user-did` header.
2. **Server responds** with a unique challenge message.
3. **Client signs** the message using its Ed25519 private key.
4. **Client sends** the signed message and DID to `/auth/verify/`.
5. **Server verifies** signature and grants access.

---

### Swift (iOS)

> ⚠️ Requires an Ed25519 signing key and a library like `CryptoKit`, `Base58Swift`, and optionally `DIDKit` for full support.

```swift
import Foundation
import CryptoKit

// Assume `privateKey` is securely stored/generated previously
let privateKey = Curve25519.Signing.PrivateKey()
let publicKey = privateKey.publicKey
let userDID = "did:key:" + base58Encode(publicKey.rawRepresentation)

// Step 1: Request challenge
func requestChallenge() async throws -> String {
    var request = URLRequest(url: URL(string: "https://your-server.com/auth/login/")!)
    request.httpMethod = "POST"
    request.setValue(userDID, forHTTPHeaderField: "x-user-did")

    let (data, _) = try await URLSession.shared.data(for: request)
    return String(data: data, encoding: .utf8)!
}

// Step 2: Sign challenge and verify
func verifyChallenge(challenge: String) async throws {
    let messageData = challenge.data(using: .utf8)!
    let signature = try privateKey.signature(for: messageData)

    let body = [
        "did": userDID,
        "signature": signature.base64EncodedString()
    ]
    let json = try JSONSerialization.data(withJSONObject: body)

    var request = URLRequest(url: URL(string: "https://your-server.com/auth/verify/")!)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = json

    let (data, _) = try await URLSession.shared.data(for: request)
    print("Auth success: \(String(data: data, encoding: .utf8)!)")
}
```

---

### Kotlin (Android)

> ⚠️ Requires Ed25519 key pair (e.g. from Bouncy Castle or Conscrypt) and base58/JSON libs.

```kotlin
import okhttp3.*
import java.security.*
import java.util.*
import org.json.JSONObject

val client = OkHttpClient()
val keyPair: KeyPair = generateEd25519KeyPair()
val userDID = "did:key:" + base58Encode(keyPair.public.encoded)

// Step 1: Get challenge
fun getChallenge(): String {
    val request = Request.Builder()
        .url("https://your-server.com/auth/login/")
        .post(RequestBody.create(null, ByteArray(0)))
        .addHeader("x-user-did", userDID)
        .build()

    val response = client.newCall(request).execute()
    return response.body?.string() ?: throw Exception("Empty challenge")
}

// Step 2: Sign challenge and send verification
fun verifyChallenge(challenge: String) {
    val signature = signMessage(challenge.toByteArray(), keyPair.private)

    val json = JSONObject()
    json.put("did", userDID)
    json.put("signature", Base64.getEncoder().encodeToString(signature))

    val requestBody = RequestBody.create("application/json".toMediaTypeOrNull(), json.toString())
    val request = Request.Builder()
        .url("https://your-server.com/auth/verify/")
        .post(requestBody)
        .build()

    val response = client.newCall(request).execute()
    println("Auth success: ${response.body?.string()}")
}

// Util: Sign with Ed25519
fun signMessage(message: ByteArray, privateKey: PrivateKey): ByteArray {
    val signature = Signature.getInstance("Ed25519")
    signature.initSign(privateKey)
    signature.update(message)
    return signature.sign()
}
```

---

### Server Expectations

| Field           | Type   | Notes                                                      |
|------------------|--------|------------------------------------------------------------|
| `x-user-did`      | header | MUST match the DID derived from the public key            |
| `challenge`       | string | Unique nonce returned by `/auth/login/`                  |
| `signature`       | base64 | Ed25519 signature of the challenge message                |
| `did`             | string | Included in `/auth/verify/` payload                       |

---

### Security Notes

- Private key must be securely stored using system keystore or secure enclave.
- The same key must be used to generate the DID and sign challenges.
- Replay protection is enforced server-side by expiring challenges.
