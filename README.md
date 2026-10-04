# 📦 DeliverEase Mock & MCP Server

Production-ready REST & **Model Context Protocol (MCP)** server for **DeliverEase** — a voice-based last-mile delivery coordination agent.

DeliverEase helps delivery partners seamlessly coordinate deliveries via an AI voice agent, verifying trusted proxy recipients (family, security desk, self, neighbors), enforcing customer autonomy policies, and managing delivery escalations and audit timelines.

Hosted on Render: [**https://deliverease-mock-server.onrender.com**](https://deliverease-mock-server.onrender.com)  
GitHub Repository: [**https://github.com/nikk-68/deliverease-mock-server**](https://github.com/nikk-68/deliverease-mock-server)

---

## 🚀 3 Custom Capabilities

### **CAPABILITY 1 — Trusted Recipient & Delivery Preferences**
- Resolves delivery modes (`ACTIVE`, `ASSIST`, `OFF`) and location preferences.
- Evaluates proxy recipient authorizations for specific locations.
- **Safety**: Never invents recipients; unknown locations or non-existent customers yield `NOT_AUTHORIZED`; least-privilege coordination data exposure.

### **CAPABILITY 2 — Delivery Mode & Autonomy Policy Engine**
- Determines permissible actions based on customer's mode:
  - **ACTIVE**: Autonomous coordination within saved permissions without unnecessary customer interruption.
  - **ASSIST**: Customer remains primary receiver; agent intervenes only when customer is unavailable, unreachable, or unresponsive.
  - **OFF**: Autonomous coordination and proxy delegation are completely disabled; status-only information.
- Evaluates situations (`customer_unavailable`, `phone_silent`, `authorized_recipient_available`, `recipient_unavailable`, `delivery_failed`) returning structured decisions: `ALLOW`, `ALLOW_WITH_ASSIST`, `DENY`, or `ESCALATE`.
- **Safety**: Never guesses missing information; ambiguous context strictly triggers `ESCALATE`.

### **CAPABILITY 3 — Delivery Escalation & Audit Timeline**
- Determines and records coordination plans and exception histories without directly performing physical courier actions.
- Handles exceptions: recipient unavailable, courier access blocked, courier refuses handoff, delivery attempt failed, reattempt needed, missing data, connector failures.
- Maintains an in-memory chronological audit timeline.
- **Safety**: Never claims delivery completed or calls/SMS succeeded without connector confirmation; missing information produces `ESCALATE`.

---

## 🤖 Model Context Protocol (MCP) Tools

The server runs a standard MCP server implementation over Server-Sent Events (SSE) compatible with remote HTTP deployment on Render.

### Registered MCP Tools (8 Custom Tools):

| # | Tool Name | Capability | Parameters | Description |
|---|---|---|---|---|
| 1 | `get_preferences` | Cap 1 | `customerId` (str) | Return current delivery mode & saved location preferences. |
| 2 | `update_preferences` | Cap 1 | `customerId` (str), `mode` (`ACTIVE`\|`ASSIST`\|`OFF`) | Update delivery mode for a customer. |
| 3 | `get_authorized_recipient` | Cap 1 | `customerId` (str), `location` (str) | Check authorized recipient for delivery location following safety rules. |
| 4 | `get_mode_policy` | Cap 2 | `customerId` (str) | Return mode policy, autonomous allowances, and intervention triggers. |
| 5 | `evaluate_delivery_action` | Cap 2 | `customerId` (str), `situation` (str) | Evaluate situation to return `ALLOW`, `ALLOW_WITH_ASSIST`, `DENY`, or `ESCALATE`. |
| 6 | `create_resolution_plan` | Cap 3 | `customerId` (str), `shipmentId` (str), `situation` (str) | Generate structured resolution plan for delivery exceptions. |
| 7 | `record_delivery_event` | Cap 3 | `customerId` (str), `shipmentId` (str), `eventType` (str), `details` (obj) | Store timestamped coordination event in immutable audit timeline. |
| 8 | `get_delivery_timeline` | Cap 3 | `customerId` (str), `shipmentId` (str) | Return chronological delivery decision and event history. |

### MCP Connection Endpoints:
- **SSE Transport URL**: `GET /sse`
- **Message Dispatch URL**: `POST /messages?sessionId={sessionId}`

#### MCP Client Configuration (e.g. Claude Desktop or Cursor):
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

## 📋 Demo Seed Data

### Customer: `DEMO001`
- **Default Mode**: `ACTIVE`

| Location | Recipient Name | Relation | Phone | Preferred Time | Authorization Status |
|---|---|---|---|---|---|
| **Home** | Sunita Sharma (Mummy) | Mother | `+919876543210` | `09:00 AM - 01:00 PM` | `AUTHORIZED` |
| **Hostel** | Aarav Sharma | Self | `+919812345678` | `06:00 PM - 09:00 PM` | `AUTHORIZED` |
| **Office** | Ramesh Kumar (Security Desk) | Security Desk | `+919823456789` | `09:00 AM - 06:00 PM` | `AUTHORIZED` |

### Shipments:
- **`SHIP001`**: Bound for `Home`, Carrier `ExpressLogistics` (`EXP-889102`), Out for Delivery.
- **`SHIP002`**: Bound for `Office`, Carrier `FastTrack` (`FT-441209`), Out for Delivery.

---

## 🛠️ REST API Reference

### Health Check
- `GET /health` — Status, version, 3 active capabilities, advertised MCP tools.

### Capability 1: Preferences & Recipient
- `GET /api/preferences/:customerId` — Get customer delivery mode and preferences.
- `PUT /api/preferences/:customerId` — Update mode and/or location preferences.
- `GET /api/recipient?customerId=...&location=...` — Query authorized recipient.

### Capability 2: Mode Policy & Action Evaluation
- `GET /api/policy/:customerId` — Get autonomy policy and intervention triggers.
- `POST /api/policy/:customerId/evaluate` — Body: `{ "situation": "customer_unavailable" }`.

### Capability 3: Resolution & Audit Timeline
- `POST /api/resolution-plan` — Body: `{ "customerId": "DEMO001", "shipmentId": "SHIP001", "situation": "..." }`.
- `POST /api/timeline/events` — Body: `{ "customerId": "DEMO001", "shipmentId": "SHIP001", "eventType": "...", "details": {...} }`.
- `GET /api/timeline?customerId=DEMO001&shipmentId=SHIP001` — Chronological event log.
- `GET /api/shipments/:shipmentId` — Shipment metadata.

### Demo Utility
- `POST /api/reset` — Resets customers, shipments, and timeline back to initial demo seeds.

---

## 🧪 Testing

Run the automated test suite covering all 3 capabilities across REST and live MCP clients:
```bash
npm test
```

### Test Coverage (70/70 Passing):
- Capability 1: Preferences retrieval, updates, recipient verification, missing param handling.
- Capability 2: Mode policy checks (`ACTIVE`, `ASSIST`, `OFF`), action evaluations, ambiguous situation escalation.
- Capability 3: Resolution plan creation, timeline retrieval, audit event recording, safety rule enforcement (completion claim rejection without connector confirmation).
- Shared State: Cross-verification that MCP updates synchronously reflect on REST endpoints.

---

## 🌐 Deployment on Render

Configured with host `0.0.0.0` and `process.env.PORT`.

- **Build Command**: `npm install`
- **Start Command**: `npm start`
- **Health Check Path**: `/health`
- **Blueprint**: [`render.yaml`](file:///Users/nihalsaini/Documents/mock%20server%20for%203%20capabilities/render.yaml)
