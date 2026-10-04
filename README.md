# 📦 DeliverEase Mock & MCP Server

Production-ready REST & **Model Context Protocol (MCP)** server for **DeliverEase** — a voice-based last-mile delivery coordination agent.

DeliverEase helps delivery partners and voice agents coordinate last-mile deliveries, evaluate proxy recipients (family, security desk, self, neighbors), recover from delivery exceptions, and orchestrate delivery notifications.

---

## 🏛️ Architecture Overview

The system runs as **ONE unified Render service** hosting all 3 capabilities sharing a single in-memory state:

```text
ONE Render Server (0.0.0.0:$PORT)
        |
        +-- Capability 1: Trusted Recipient & Preferences
        |       - Customer preferences, location registry, authorization checks
        |       - Master delivery mode state (ACTIVE | ASSIST | OFF)
        |
        +-- Capability 2: Delivery Recovery
        |       - Evaluates delivery failures, NDRs, courier refusals, timing conflicts
        |       - Generates structured recovery plans (REATTEMPT, RESCHEDULE, ESCALATE)
        |       - Enforces safe escalation for missing info and blocks proxy handoff in OFF mode
        |
        +-- Capability 3: Delivery Notifications
                - Prepares, tracks, and manages notifications for customers & recipients
                - Transitions from PENDING -> SENT -> DELIVERED via confirmed connectors
                - Maintains chronological delivery communication audit log
```

- **Render Service**: `https://deliverease-mock-server.onrender.com`
- **GitHub Repository**: `nikk-68/deliverease-mock-server`
- **MCP SSE Transport**: `GET /sse` & `POST /messages?sessionId=...`

---

## 🔒 Master Mode System (Capability 1 Shared State)

The three delivery modes are stored in Capability 1 and govern the autonomous policy for all capabilities:

| Mode | Autonomous Agent Policy |
|---|---|
| **`ACTIVE`** | Agent can autonomously coordinate routine delivery problems within customer's existing permissions. |
| **`ASSIST`** | Agent normally lets customer handle delivery, but intervenes when customer is unavailable, unreachable, or unresponsive. |
| **`OFF`** | Agent **must not** autonomously coordinate a proxy handoff or take delivery actions on behalf of customer. |

Changing the mode via `update_preferences(customerId, mode)` immediately impacts Capability 2 and Capability 3.

---

## 📋 Demo Seed Customer (`DEMO001`)

- **Customer ID**: `DEMO001`
- **Customer Name**: `Aarav Sharma`
- **Default Mode**: `ACTIVE`

### Pre-Configured Locations & Recipients:

| Location | Recipient Name | Relation | Phone | Preferred Time | Authorization Status |
|---|---|---|---|---|---|
| **Home** | Sunita Sharma (Mummy) | Mother | `+919876543210` | `09:00 AM - 01:00 PM` | `AUTHORIZED` |
| **Hostel** | Aarav Sharma (Self) | Self | `+919812345678` | `06:00 PM - 09:00 PM` | `AUTHORIZED` |
| **Office** | Ramesh Kumar (Security Desk) | Security Desk | `+919823456789` | `09:00 AM - 06:00 PM` | `AUTHORIZED` |

---

## 🤖 Registered MCP Tools (Exactly 9 Tools)

The server exposes 9 standard MCP tools over Server-Sent Events (SSE):

### **CAPABILITY 1 — Trusted Recipient & Delivery Preferences**

1. **`get_preferences`**
   - **Params**: `customerId` (string)
   - **Returns**: Customer delivery mode (`ACTIVE`, `ASSIST`, `OFF`) and configured location preferences.

2. **`update_preferences`**
   - **Params**: `customerId` (string), `mode` (`ACTIVE` \| `ASSIST` \| `OFF`)
   - **Returns**: Updated customer delivery mode and preferences.

3. **`get_authorized_recipient`**
   - **Params**: `customerId` (string), `location` (string)
   - **Returns**: Authorized recipient details or `NOT_AUTHORIZED` if unauthorized or mode is `OFF`.

---

### **CAPABILITY 2 — Delivery Recovery**

4. **`get_recovery_options`**
   - **Params**: `customerId` (string), `shipmentId` (string), `situation` (string)
   - **Returns**: `shipmentId`, `situation`, `availableActions`, `recommendedAction`, `reason`, `escalationRequired`.
   - **Possible actions**: `REATTEMPT`, `RESCHEDULE`, `CONTACT_RECIPIENT`, `CONTACT_CUSTOMER`, `ESCALATE`, `NO_ACTION`.

5. **`create_recovery_plan`**
   - **Params**: `customerId` (string), `shipmentId` (string), `situation` (string), `requestedAction` (enum)
   - **Returns**: `success`, `shipmentId`, `recoveryAction`, `nextStep`, `requiredInformation`, `escalationRequired`, `reason`.
   - **Status**: Saved in shared state as `PLAN_CREATED` (never claimed as executed without external connector confirmation).

6. **`get_recovery_status`**
   - **Params**: `customerId` (string), `shipmentId` (string)
   - **Returns**: Current recovery plan, status, next step, and required information from shared state.

---

### **CAPABILITY 3 — Delivery Notifications**

7. **`create_notification`**
   - **Params**: `customerId` (string), `shipmentId` (string), `recipientType` (`CUSTOMER` \| `AUTHORIZED_RECIPIENT`), `notificationType` (string), `message` (string)
   - **Returns**: `notificationId`, `customerId`, `shipmentId`, `recipientType`, `notificationType`, `message`, `status: "PENDING"`.
   - **Safety**: Uses only verified contact details from Capability 1; never invents recipients.

8. **`update_notification_status`**
   - **Params**: `notificationId` (string), `status` (`PENDING` \| `SENT` \| `DELIVERED` \| `FAILED`), `connector` (string), `details` (string, optional)
   - **Safety**: Rejects `SENT` or `DELIVERED` without confirmed communication connector.

9. **`get_notification_history`**
   - **Params**: `customerId` (string), `shipmentId` (string)
   - **Returns**: Chronological notification audit records for that shipment.

---

## 🛡️ Universal Safety Principles

1. **Never invent recipients**: Unregistered locations or non-existent customers yield `NOT_AUTHORIZED`. Notifications for recipients must use Capability 1 verified data.
2. **Never invent delivery status**: Recovery plans are created as `PLAN_CREATED`. Notification requests start as `PENDING`.
3. **Never claim external execution without confirmation**: Notifications cannot transition to `SENT` or `DELIVERED` without a valid `connector` argument.
4. **Missing information => safe escalation**: Unresolvable delivery situations return `ESCALATE` with `escalationRequired: true`.
5. **Mode OFF blocks autonomous proxy handoff**: When mode is `OFF`, recipient authorization and proxy delegation actions are strictly denied.
6. **Least privilege exposure**: Exposes only necessary coordination fields (`recipientName`, `recipientRelation`, `recipientPhone`, `preferredTime`).

---

## 🌐 MCP SSE Connection Configuration

### Remote Render Connection (Production)
```json
{
  "mcpServers": {
    "deliverease": {
      "url": "https://deliverease-mock-server.onrender.com/sse"
    }
  }
}
```

### Local Connection
```json
{
  "mcpServers": {
    "deliverease": {
      "url": "http://localhost:3000/sse"
    }
  }
}
```

---

## 🛠️ REST API Reference

| Capability | Method | Endpoint | Description |
|---|---|---|---|
| **System** | `GET` | `/health` | Server status, active capabilities, and 9 MCP tools |
| **System** | `POST` | `/api/reset` | Resets all 3 capabilities to initial demo state |
| **Cap 1** | `GET` | `/api/preferences/:customerId` | Get delivery mode and location preferences |
| **Cap 1** | `PUT` | `/api/preferences/:customerId` | Update delivery mode and/or location preferences |
| **Cap 1** | `GET` | `/api/recipient?customerId=...&location=...` | Query authorized recipient for delivery location |
| **Cap 2** | `POST`| `/api/recovery/options` | Evaluate delivery problem and get recommendations |
| **Cap 2** | `POST`| `/api/recovery/plan` | Create structured recovery plan |
| **Cap 2** | `GET` | `/api/recovery/status/:shipmentId` | Get recovery plan status |
| **Cap 3** | `POST`| `/api/notifications` | Create notification request (status: PENDING) |
| **Cap 3** | `PUT` | `/api/notifications/:notificationId` | Update status with connector confirmation |
| **Cap 3** | `GET` | `/api/notifications/:shipmentId` | Get chronological notification history |

---

## 💻 Quick Start & Testing

```bash
# 1. Install dependencies
npm install

# 2. Run automated test suite (86 passing tests)
npm test

# 3. Start local development server
npm start
```
