# 📦 DeliverEase Mock & MCP Server

Production-ready REST & **Model Context Protocol (MCP)** server for **DeliverEase** — a voice-based last-mile delivery coordination agent.

DeliverEase helps delivery partners seamlessly coordinate deliveries via an AI voice agent, verifying trusted proxy recipients (family, security desk, self, neighbors) and respecting user delivery preferences when customers are busy or away.

---

## 🚀 Implemented Capabilities

### **CAPABILITY 1 — Trusted Recipient & Delivery Preferences**

Supports both **REST API endpoints** and standard **MCP Tools over SSE** (`/sse` & `/messages`) compatible with remote HTTP deployment on Render.

#### Key Safety Rules Enforced:
1. **Never invent an authorized recipient**: If a location or customer is unregistered or unauthorized, the server returns a clear `NOT_AUTHORIZED` status.
2. **Safe Mode Enforcement**: If the customer sets delivery mode to `OFF`, proxy delegation is disabled and queries resolve to `NOT_AUTHORIZED`.
3. **Least Privilege Data Exposure**: Returns only the minimal necessary recipient details (`recipientName`, `recipientRelation`, `recipientPhone`, `preferredTime`) required for the delivery agent to coordinate handover.
4. **Input Validation**: Strict input validation using Zod for MCP tools and Express schema checks for REST endpoints.

---

## 🤖 Model Context Protocol (MCP) Tools

The server runs a standard MCP server implementation over Server-Sent Events (SSE), enabling AI agents (e.g. Claude Desktop, Cursor, custom voice agents) to invoke tools directly over HTTP.

### Available MCP Tools:

#### 1. `get_preferences`
- **Description**: Return customer delivery mode (`ACTIVE` \| `ASSIST` \| `OFF`) and saved location preferences.
- **Parameters**:
  - `customerId` (string, required): e.g. `"DEMO001"`

#### 2. `update_preferences`
- **Description**: Update delivery mode (`ACTIVE`, `ASSIST`, or `OFF`) for a customer.
- **Parameters**:
  - `customerId` (string, required): e.g. `"DEMO001"`
  - `mode` (`"ACTIVE"` \| `"ASSIST"` \| `"OFF"`, required)

#### 3. `get_authorized_recipient`
- **Description**: Query authorized recipient for a customer delivery location following safety rules. Never invents recipients; returns clear `NOT_AUTHORIZED` if no recipient is authorized or mode is `OFF`.
- **Parameters**:
  - `customerId` (string, required): e.g. `"DEMO001"`
  - `location` (string, required): e.g. `"Home"`, `"Hostel"`, `"Office"`

### MCP Connection Endpoints:
- **SSE Transport URL**: `GET /sse`
- **Message Receiver**: `POST /messages?sessionId={sessionId}`

#### MCP Client Configuration Example (e.g. Claude Desktop or Cursor):
```json
{
  "mcpServers": {
    "deliverease": {
      "url": "https://deliverease-mock-server.onrender.com/sse"
    }
  }
}
```
*(For local testing, use `http://localhost:3000/sse`)*

---

## 📋 Demo Seed Customer

The server pre-seeds customer **`DEMO001`**:

| Field | Value |
|---|---|
| **Customer ID** | `DEMO001` |
| **Delivery Mode** | `ACTIVE` (`ACTIVE` \| `ASSIST` \| `OFF`) |

### Pre-Configured Locations & Recipients:

| Location | Recipient Name | Relation | Phone | Preferred Time | Authorization Status |
|---|---|---|---|---|---|
| **Home** | Sunita Sharma (Mummy) | Mother | `+919876543210` | `09:00 AM - 01:00 PM` | `AUTHORIZED` |
| **Hostel** | Aarav Sharma | Self | `+919812345678` | `06:00 PM - 09:00 PM` | `AUTHORIZED` |
| **Office** | Ramesh Kumar (Security Desk) | Security Desk | `+919823456789` | `09:00 AM - 06:00 PM` | `AUTHORIZED` |

---

## 🛠️ API Reference

### 1. Health Check
Checks mock server status and lists active capabilities.

- **URL**: `GET /health`
- **Response**: `200 OK`
```json
{
  "status": "UP",
  "service": "DeliverEase Mock Server",
  "version": "1.0.0",
  "capabilities": [
    "CAPABILITY 1 — Trusted Recipient & Delivery Preferences"
  ],
  "timestamp": "2026-10-04T09:54:06.776Z"
}
```

---

### 2. Get Customer Preferences
Retrieves delivery mode and all configured location preferences for a customer.

- **URL**: `GET /api/preferences/:customerId`
- **Path Parameters**:
  - `customerId`: Customer ID (e.g. `DEMO001`)
- **Response**: `200 OK`
```json
{
  "success": true,
  "customerId": "DEMO001",
  "mode": "ACTIVE",
  "preferences": [
    {
      "location": "Home",
      "recipientName": "Sunita Sharma (Mummy)",
      "recipientRelation": "Mother",
      "recipientPhone": "+919876543210",
      "preferredTime": "09:00 AM - 01:00 PM",
      "authorizationStatus": "AUTHORIZED"
    },
    {
      "location": "Hostel",
      "recipientName": "Aarav Sharma",
      "recipientRelation": "Self",
      "recipientPhone": "+919812345678",
      "preferredTime": "06:00 PM - 09:00 PM",
      "authorizationStatus": "AUTHORIZED"
    },
    {
      "location": "Office",
      "recipientName": "Ramesh Kumar (Security Desk)",
      "recipientRelation": "Security Desk",
      "recipientPhone": "+919823456789",
      "preferredTime": "09:00 AM - 06:00 PM",
      "authorizationStatus": "AUTHORIZED"
    }
  ]
}
```

- **Error Response** (`404 Not Found`):
```json
{
  "success": false,
  "error": "Customer not found with ID 'UNKNOWN'.",
  "customerId": "UNKNOWN"
}
```

---

### 3. Update Customer Preferences
Updates the customer's delivery mode (`ACTIVE`, `ASSIST`, `OFF`) and/or location preferences.

- **URL**: `PUT /api/preferences/:customerId`
- **Headers**: `Content-Type: application/json`

#### Example A: Update Delivery Mode only
```json
{
  "mode": "ASSIST"
}
```

#### Example B: Update or Add a Single Location Preference
```json
{
  "location": "Home",
  "recipientName": "Rajesh Sharma (Papa)",
  "recipientRelation": "Father",
  "recipientPhone": "+919876543299",
  "preferredTime": "02:00 PM - 05:00 PM",
  "authorizationStatus": "AUTHORIZED"
}
```

#### Example C: Replace entire preferences array
```json
{
  "mode": "ACTIVE",
  "preferences": [
    {
      "location": "Home",
      "recipientName": "Sunita Sharma (Mummy)",
      "recipientRelation": "Mother",
      "recipientPhone": "+919876543210",
      "preferredTime": "09:00 AM - 01:00 PM",
      "authorizationStatus": "AUTHORIZED"
    }
  ]
}
```

- **Response**: `200 OK`
```json
{
  "success": true,
  "message": "Customer preferences updated successfully.",
  "customerId": "DEMO001",
  "mode": "ASSIST",
  "preferences": [...]
}
```

---

### 4. Query Authorized Recipient
Queries whether a recipient is authorized to receive a delivery at a specific location.

- **URL**: `GET /api/recipient?customerId={customerId}&location={location}`
- **Query Parameters**:
  - `customerId` (required): e.g. `DEMO001`
  - `location` (required): e.g. `Home`, `Hostel`, `Office` (case-insensitive)

#### Success Response — Authorized (`200 OK`):
```json
{
  "success": true,
  "customerId": "DEMO001",
  "location": "Home",
  "mode": "ACTIVE",
  "authorizationStatus": "AUTHORIZED",
  "recipientName": "Sunita Sharma (Mummy)",
  "recipientRelation": "Mother",
  "recipientPhone": "+919876543210",
  "preferredTime": "09:00 AM - 01:00 PM",
  "recipient": {
    "name": "Sunita Sharma (Mummy)",
    "relation": "Mother",
    "phone": "+919876543210",
    "preferredTime": "09:00 AM - 01:00 PM"
  }
}
```

#### Safety Response — Location Not Registered / Unauthorized (`200 OK`):
```json
{
  "success": true,
  "customerId": "DEMO001",
  "location": "Gym",
  "mode": "ACTIVE",
  "authorizationStatus": "NOT_AUTHORIZED",
  "recipient": null,
  "message": "No authorized recipient found for location \"Gym\"."
}
```

#### Safety Response — Mode OFF (`200 OK`):
```json
{
  "success": true,
  "customerId": "DEMO001",
  "location": "Home",
  "mode": "OFF",
  "authorizationStatus": "NOT_AUTHORIZED",
  "recipient": null,
  "message": "Proxy recipient delivery is disabled because customer delivery mode is set to OFF."
}
```

#### Error Response — Missing Query Params (`400 Bad Request`):
```json
{
  "success": false,
  "error": "Missing required query parameter: \"customerId\" is required."
}
```

#### Error Response — Non-Existent Customer (`404 Not Found`):
```json
{
  "success": false,
  "authorizationStatus": "NOT_AUTHORIZED",
  "error": "Customer not found with ID 'FAKE999'.",
  "customerId": "FAKE999",
  "location": "Home"
}
```

---

### 5. Reset Demo Data (Hackathon Utility)
Restores the in-memory database back to default seed data (`DEMO001` with Home, Hostel, Office in `ACTIVE` mode).

- **URL**: `POST /api/reset`
- **Response**: `200 OK`
```json
{
  "success": true,
  "message": "Demo customer data reset to initial state.",
  "customers": ["DEMO001"]
}
```

---

## 🌐 Deploy to Render

This repository is ready for immediate deployment on [Render](https://render.com).

### Deployment Settings:
- **Environment**: `Node`
- **Build Command**: `npm install`
- **Start Command**: `npm start`
- **Health Check Path**: `/health`
- **Environment Variables**:
  - `PORT`: Automatically set by Render
  - `NODE_ENV`: `production`

Render will automatically bind to `0.0.0.0` and allocate a public HTTPS URL (e.g. `https://deliverease-mock-server.onrender.com`).

---

## 💻 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Copy `.env.example` to `.env` (optional, defaults to port 3000):
```bash
cp .env.example .env
```

### 3. Start the Server
```bash
# Production mode
npm start

# Development watch mode
npm run dev
```

### 4. Run Automated Test Suite
```bash
npm test
```

---

## 🧪 Testing with cURL

```bash
# Health check
curl -X GET http://localhost:3000/health

# Get customer preferences
curl -X GET http://localhost:3000/api/preferences/DEMO001

# Query recipient for Home (Authorized Mummy)
curl -X GET "http://localhost:3000/api/recipient?customerId=DEMO001&location=Home"

# Query recipient for Hostel (Authorized Self)
curl -X GET "http://localhost:3000/api/recipient?customerId=DEMO001&location=Hostel"

# Query recipient for Office (Authorized Security Desk)
curl -X GET "http://localhost:3000/api/recipient?customerId=DEMO001&location=Office"

# Query recipient for unregistered location (NOT_AUTHORIZED)
curl -X GET "http://localhost:3000/api/recipient?customerId=DEMO001&location=Gym"

# Update delivery mode to ASSIST
curl -X PUT http://localhost:3000/api/preferences/DEMO001 \
  -H "Content-Type: application/json" \
  -d '{"mode": "ASSIST"}'

# Reset demo data back to initial state
curl -X POST http://localhost:3000/api/reset
```
