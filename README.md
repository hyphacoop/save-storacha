# Save Storacha

## Proposed architecture

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
        API --> KV
        API --> SDK
    end

    %% storacha storage
    subgraph Storacha["storacha storage"]
        style Storacha fill:#181818,stroke:#555,color:#ddd
        BR["HTTP API bridge"]
        DB["Storage"]
        BR --> DB
    end

    %% flows
    AA -- "POST /space/import" --> API
    AA -- "POST /delegate"     --> API
    UA -- "POST /token"        --> API
    API -- "token + CID"       --> UA
    UA -- "CAR + headers"      --> BR
```

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
        note over AdminApp,TokenSvc: bootstrap space (one-time)
        AdminApp->>TokenSvc: POST /space/import (DID, key, coupon)
        TokenSvc-->>AdminApp: 201 CREATED
    end

    rect rgb(36,36,36)
        note over AdminApp,TokenSvc: delegate user
        AdminApp->>TokenSvc: POST /delegate {userDid, caps:[store,upload]}
        TokenSvc-->>AdminApp: {delegationCid}
    end

    rect rgb(26,26,26)
        note over UserApp,Bridge: normal upload
        UserApp ->> TokenSvc: POST /token?space=<did>&aud=<userDid>
        TokenSvc-->>UserApp: {xAuthSecret, authorizationCar}
        UserApp ->> Bridge: POST /bridge/tasks (CAR + headers)
        Bridge  ->> Storage: persist blocks
        Bridge  -->> UserApp: 200 / receipt
    end
```

## User journeys

### Admin journey
(on storacha)
- creates an account and a space  
(in app)
- logs in with email
- selects space
- inputs user DID to delegate upload cabapilities

### User journey
- app generates keypair + DID
- user copies DID and sends to admin
- (once delegation is issued, auth tokens are generated)
- users uploads to storacha

## UI

### Admin view

- email input
- space dropdown
- user DID input

### User view

- did string
- copy to clipboard and/or QR code
- (once delegated) upload UI
