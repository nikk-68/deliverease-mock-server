require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');
const { z } = require('zod');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// ==========================================
// Middleware
// ==========================================
app.use(cors());
app.use(express.json());

// Request logger for hackathon demo visibility
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// ==========================================
// In-Memory Shared Data Store (3 Capabilities)
// ==========================================
const VALID_MODES = ['ACTIVE', 'ASSIST', 'OFF'];
const VALID_AUTH_STATUSES = ['AUTHORIZED', 'NOT_AUTHORIZED'];
const ALLOWED_RECOVERY_ACTIONS = ['REATTEMPT', 'RESCHEDULE', 'CONTACT_RECIPIENT', 'CONTACT_CUSTOMER', 'ESCALATE', 'NO_ACTION'];
const ALLOWED_NOTIFICATION_STATUSES = ['PENDING', 'SENT', 'DELIVERED', 'FAILED'];

// Capability 1: Demo Customers & Preferences
const getInitialSeedData = () => ({
  DEMO001: {
    customerId: 'DEMO001',
    customerName: 'Aarav Sharma',
    mode: 'ACTIVE',
    preferences: [
      {
        location: 'Home',
        recipientName: 'Sunita Sharma (Mummy)',
        recipientRelation: 'Mother',
        recipientPhone: '+919876543210',
        preferredTime: '09:00 AM - 01:00 PM',
        authorizationStatus: 'AUTHORIZED'
      },
      {
        location: 'Hostel',
        recipientName: 'Aarav Sharma (Self)',
        recipientRelation: 'Self',
        recipientPhone: '+919812345678',
        preferredTime: '06:00 PM - 09:00 PM',
        authorizationStatus: 'AUTHORIZED'
      },
      {
        location: 'Office',
        recipientName: 'Ramesh Kumar (Security Desk)',
        recipientRelation: 'Security Desk',
        recipientPhone: '+919823456789',
        preferredTime: '09:00 AM - 06:00 PM',
        authorizationStatus: 'AUTHORIZED'
      }
    ]
  }
});

// Capability 2: Recovery Plans Store
const getInitialRecoveryData = () => ({
  SHIP001: {
    shipmentId: 'SHIP001',
    customerId: 'DEMO001',
    situation: 'recipient unavailable',
    recoveryAction: 'CONTACT_CUSTOMER',
    status: 'PLAN_CREATED',
    nextStep: 'Initiate outbound customer voice/SMS outreach for delivery coordination.',
    requiredInformation: [],
    escalationRequired: false,
    reason: 'Authorized recipient was unavailable at location. Reverting to customer.',
    createdAt: '2026-10-04T09:00:00.000Z'
  }
});

// Capability 3: Notifications Store
let notificationCounter = 1;
const getInitialNotificationsData = () => ([
  {
    notificationId: 'NOTIF-001',
    customerId: 'DEMO001',
    shipmentId: 'SHIP001',
    recipientType: 'CUSTOMER',
    notificationType: 'ARRIVING_SOON',
    message: 'Your DeliverEase package SHIP001 is arriving soon.',
    status: 'DELIVERED',
    connector: 'Twilio-SMS',
    details: 'Delivered via Twilio connector',
    createdAt: '2026-10-04T09:15:00.000Z',
    updatedAt: '2026-10-04T09:15:30.000Z'
  }
]);

// Shared State Instances
let customersStore = getInitialSeedData();
let recoveryStore = getInitialRecoveryData();
let notificationsStore = getInitialNotificationsData();

function generateNotificationId() {
  notificationCounter += 1;
  return `NOTIF-${String(notificationCounter).padStart(3, '0')}`;
}

// ==========================================
// Helper / Validation Functions
// ==========================================
function validatePreferenceItem(pref) {
  if (!pref || typeof pref !== 'object') {
    return 'Each preference must be a valid object.';
  }
  if (!pref.location || typeof pref.location !== 'string' || !pref.location.trim()) {
    return 'Preference location is required and must be a non-empty string.';
  }
  if (pref.authorizationStatus && !VALID_AUTH_STATUSES.includes(pref.authorizationStatus.toUpperCase())) {
    return `Invalid authorizationStatus "${pref.authorizationStatus}". Must be one of: ${VALID_AUTH_STATUSES.join(', ')}`;
  }
  return null;
}

// Helper to evaluate recovery options based on situation and shared mode
function evaluateRecoveryOptions(customer, shipmentId, situation) {
  const normSituation = (situation || '').trim().toLowerCase();

  // Safety rule: Missing required information => ESCALATE
  if (!normSituation || normSituation.includes('missing') || normSituation === 'unknown') {
    return {
      shipmentId,
      situation: situation || 'UNKNOWN',
      availableActions: ['ESCALATE'],
      recommendedAction: 'ESCALATE',
      reason: 'Required delivery information is missing or ambiguous. Escalation required for human safety check.',
      escalationRequired: true
    };
  }

  // Safety rule: Customer mode OFF prevents autonomous proxy handoff
  if (customer.mode === 'OFF') {
    return {
      shipmentId,
      situation,
      availableActions: ['CONTACT_CUSTOMER', 'RESCHEDULE', 'ESCALATE'],
      recommendedAction: 'CONTACT_CUSTOMER',
      reason: 'Customer delivery mode is OFF. Autonomous proxy delegation is disabled; must contact customer directly or escalate.',
      escalationRequired: normSituation.includes('refuse') || normSituation.includes('ndr')
    };
  }

  // ASSIST Mode: Customer handles delivery unless unavailable/unresponsive
  if (customer.mode === 'ASSIST') {
    if (normSituation.includes('customer unavailable') || normSituation.includes('customer unreachable')) {
      return {
        shipmentId,
        situation,
        availableActions: ['CONTACT_RECIPIENT', 'REATTEMPT', 'RESCHEDULE', 'ESCALATE'],
        recommendedAction: 'CONTACT_RECIPIENT',
        reason: 'Customer is unavailable in ASSIST mode. Escalating routine intervention to authorized trusted recipient.',
        escalationRequired: false
      };
    }
    return {
      shipmentId,
      situation,
      availableActions: ['CONTACT_CUSTOMER', 'RESCHEDULE', 'REATTEMPT', 'ESCALATE'],
      recommendedAction: 'CONTACT_CUSTOMER',
      reason: 'ASSIST mode requires consulting the primary customer first before taking proxy actions.',
      escalationRequired: false
    };
  }

  // ACTIVE Mode: Autonomous coordination within permissions
  if (normSituation.includes('recipient unavailable')) {
    return {
      shipmentId,
      situation,
      availableActions: ['CONTACT_CUSTOMER', 'RESCHEDULE', 'REATTEMPT', 'ESCALATE'],
      recommendedAction: 'CONTACT_CUSTOMER',
      reason: 'Authorized recipient was not available at location. Contacting customer for fallback direction.',
      escalationRequired: false
    };
  }

  if (normSituation.includes('refuse') || normSituation.includes('courier refuses handoff')) {
    return {
      shipmentId,
      situation,
      availableActions: ['CONTACT_CUSTOMER', 'ESCALATE'],
      recommendedAction: 'ESCALATE',
      reason: 'Courier refuses proxy handoff. Requires verification escalation or dispatch supervisor clearance.',
      escalationRequired: true
    };
  }

  if (normSituation.includes('cannot access') || normSituation.includes('access location')) {
    return {
      shipmentId,
      situation,
      availableActions: ['CONTACT_RECIPIENT', 'CONTACT_CUSTOMER', 'RESCHEDULE', 'ESCALATE'],
      recommendedAction: 'CONTACT_RECIPIENT',
      reason: 'Courier cannot access location. Contacting authorized proxy recipient to assist with gate/entry access.',
      escalationRequired: false
    };
  }

  if (normSituation.includes('reschedul') || normSituation.includes('timing')) {
    return {
      shipmentId,
      situation,
      availableActions: ['RESCHEDULE', 'REATTEMPT', 'CONTACT_CUSTOMER', 'ESCALATE'],
      recommendedAction: 'RESCHEDULE',
      reason: 'Customer/courier delivery timing conflict. Rescheduling delivery slot is recommended.',
      escalationRequired: false
    };
  }

  if (normSituation.includes('reattempt') || normSituation.includes('failed') || normSituation.includes('ndr') || normSituation.includes('missed')) {
    return {
      shipmentId,
      situation,
      availableActions: ['REATTEMPT', 'RESCHEDULE', 'CONTACT_CUSTOMER', 'ESCALATE'],
      recommendedAction: 'REATTEMPT',
      reason: 'Delivery attempt failed or missed. Scheduling next-day courier reattempt.',
      escalationRequired: false
    };
  }

  // Fallback for customer unavailable in ACTIVE mode
  if (normSituation.includes('customer unavailable')) {
    return {
      shipmentId,
      situation,
      availableActions: ['CONTACT_RECIPIENT', 'RESCHEDULE', 'REATTEMPT', 'ESCALATE'],
      recommendedAction: 'CONTACT_RECIPIENT',
      reason: 'Customer unavailable in ACTIVE mode. Autonomous proxy recipient coordination initiated.',
      escalationRequired: false
    };
  }

  // General safe fallback
  return {
    shipmentId,
    situation,
    availableActions: ['CONTACT_CUSTOMER', 'REATTEMPT', 'ESCALATE', 'NO_ACTION'],
    recommendedAction: 'CONTACT_CUSTOMER',
    reason: 'Standard delivery issue. Contacting customer for clarification.',
    escalationRequired: false
  };
}

// ==========================================
// MCP (Model Context Protocol) Server & Tools
// ==========================================
function createDeliverEaseMcpServer() {
  const mcpServer = new McpServer({
    name: 'deliverease-mcp-server',
    version: '1.0.0'
  });

  // ------------------------------------------
  // CAPABILITY 1 TOOLS
  // ------------------------------------------

  // Tool 1: get_preferences(customerId)
  mcpServer.tool(
    'get_preferences',
    'Return the customer current delivery mode (ACTIVE | ASSIST | OFF) and saved location preferences.',
    {
      customerId: z.string().describe('Customer identifier (e.g. DEMO001)')
    },
    async ({ customerId }) => {
      const key = customerId ? customerId.trim().toUpperCase() : '';
      const customer = customersStore[key];
      if (!customer) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: `Customer not found with ID '${customerId}'.`,
                customerId
              })
            }
          ]
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              customerId: customer.customerId,
              mode: customer.mode,
              preferences: customer.preferences
            }, null, 2)
          }
        ]
      };
    }
  );

  // Tool 2: update_preferences(customerId, mode)
  mcpServer.tool(
    'update_preferences',
    'Update delivery mode (ACTIVE, ASSIST, OFF) for a customer in shared state.',
    {
      customerId: z.string().describe('Customer identifier (e.g. DEMO001)'),
      mode: z.enum(['ACTIVE', 'ASSIST', 'OFF']).describe('New delivery mode: ACTIVE, ASSIST, or OFF')
    },
    async ({ customerId, mode }) => {
      const key = customerId ? customerId.trim().toUpperCase() : '';
      const customer = customersStore[key];
      if (!customer) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: `Customer not found with ID '${customerId}'.`
              })
            }
          ]
        };
      }

      customer.mode = mode.trim().toUpperCase();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `Customer '${customer.customerId}' delivery mode updated to ${customer.mode}.`,
              customerId: customer.customerId,
              mode: customer.mode,
              preferences: customer.preferences
            }, null, 2)
          }
        ]
      };
    }
  );

  // Tool 3: get_authorized_recipient(customerId, location)
  mcpServer.tool(
    'get_authorized_recipient',
    'Query authorized recipient for a customer delivery location following safety rules. Never invents recipients; returns clear NOT_AUTHORIZED if no recipient is authorized or mode is OFF.',
    {
      customerId: z.string().describe('Customer identifier (e.g. DEMO001)'),
      location: z.string().describe('Delivery location name (e.g. Home, Hostel, Office)')
    },
    async ({ customerId, location }) => {
      const cleanCustomerId = customerId ? customerId.trim().toUpperCase() : '';
      const cleanLocation = location ? location.trim() : '';

      const customer = customersStore[cleanCustomerId];
      if (!customer) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                authorizationStatus: 'NOT_AUTHORIZED',
                error: `Customer not found with ID '${customerId}'.`,
                customerId: cleanCustomerId,
                location: cleanLocation
              }, null, 2)
            }
          ]
        };
      }

      // Safety rule: mode OFF disables proxy recipient delivery
      if (customer.mode === 'OFF') {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                customerId: customer.customerId,
                location: cleanLocation,
                mode: customer.mode,
                authorizationStatus: 'NOT_AUTHORIZED',
                recipient: null,
                message: 'Proxy recipient delivery is disabled because customer delivery mode is set to OFF.'
              }, null, 2)
            }
          ]
        };
      }

      // Location match (case-insensitive)
      const matchedPref = customer.preferences.find(
        p => p.location.trim().toLowerCase() === cleanLocation.toLowerCase()
      );

      // Safety rule: never invent an authorized recipient
      if (!matchedPref || matchedPref.authorizationStatus !== 'AUTHORIZED') {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                customerId: customer.customerId,
                location: cleanLocation,
                mode: customer.mode,
                authorizationStatus: 'NOT_AUTHORIZED',
                recipient: null,
                message: `No authorized recipient found for location "${cleanLocation}".`
              }, null, 2)
            }
          ]
        };
      }

      // Authorized recipient response - minimal necessary coordination data
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              customerId: customer.customerId,
              location: matchedPref.location,
              mode: customer.mode,
              authorizationStatus: 'AUTHORIZED',
              recipientName: matchedPref.recipientName,
              recipientRelation: matchedPref.recipientRelation,
              recipientPhone: matchedPref.recipientPhone,
              preferredTime: matchedPref.preferredTime,
              recipient: {
                name: matchedPref.recipientName,
                relation: matchedPref.recipientRelation,
                phone: matchedPref.recipientPhone,
                preferredTime: matchedPref.preferredTime
              }
            }, null, 2)
          }
        ]
      };
    }
  );

  // ------------------------------------------
  // CAPABILITY 2 TOOLS (Delivery Recovery)
  // ------------------------------------------

  // Tool 4: get_recovery_options(customerId, shipmentId, situation)
  mcpServer.tool(
    'get_recovery_options',
    'Evaluate delivery problem and return available actions, recommended action, and escalation status based on shared customer mode.',
    {
      customerId: z.string().describe('Customer ID (e.g. DEMO001)'),
      shipmentId: z.string().describe('Shipment / tracking ID (e.g. SHIP001)'),
      situation: z.string().describe('Delivery exception situation (e.g. delivery failed, recipient unavailable, courier refuses handoff)')
    },
    async ({ customerId, shipmentId, situation }) => {
      const cleanCustomerId = customerId ? customerId.trim().toUpperCase() : '';
      const cleanShipmentId = shipmentId ? shipmentId.trim() : '';

      const customer = customersStore[cleanCustomerId];
      if (!customer) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                shipmentId: cleanShipmentId,
                situation,
                availableActions: ['ESCALATE'],
                recommendedAction: 'ESCALATE',
                reason: `Customer '${customerId}' not found. Cannot determine recovery options.`,
                escalationRequired: true
              }, null, 2)
            }
          ]
        };
      }

      const options = evaluateRecoveryOptions(customer, cleanShipmentId, situation);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(options, null, 2)
          }
        ]
      };
    }
  );

  // Tool 5: create_recovery_plan(customerId, shipmentId, situation, requestedAction)
  mcpServer.tool(
    'create_recovery_plan',
    'Create and record a structured recovery plan for a delivery problem in shared state following safety rules.',
    {
      customerId: z.string().describe('Customer ID (e.g. DEMO001)'),
      shipmentId: z.string().describe('Shipment ID (e.g. SHIP001)'),
      situation: z.string().describe('Delivery exception situation'),
      requestedAction: z.enum(['REATTEMPT', 'RESCHEDULE', 'CONTACT_RECIPIENT', 'CONTACT_CUSTOMER', 'ESCALATE', 'NO_ACTION']).describe('Requested recovery action')
    },
    async ({ customerId, shipmentId, situation, requestedAction }) => {
      const cleanCustomerId = customerId ? customerId.trim().toUpperCase() : '';
      const cleanShipmentId = shipmentId ? shipmentId.trim() : '';

      const customer = customersStore[cleanCustomerId];
      if (!customer) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                shipmentId: cleanShipmentId,
                recoveryAction: 'ESCALATE',
                nextStep: 'Escalate to customer support desk.',
                requiredInformation: [],
                escalationRequired: true,
                reason: `Customer '${customerId}' not found.`
              }, null, 2)
            }
          ]
        };
      }

      // Safety rule: Missing required information => ESCALATE
      const normSit = (situation || '').trim().toLowerCase();
      if (!normSit || normSit.includes('missing') || normSit === 'unknown') {
        const plan = {
          success: false,
          shipmentId: cleanShipmentId,
          recoveryAction: 'ESCALATE',
          nextStep: 'Obtain missing delivery details from carrier or human operations.',
          requiredInformation: ['missing_delivery_details'],
          escalationRequired: true,
          reason: 'Required delivery information is missing. Plan cannot proceed autonomously.'
        };
        recoveryStore[cleanShipmentId] = { ...plan, customerId: cleanCustomerId, status: 'PLAN_CREATED', createdAt: new Date().toISOString() };
        return {
          content: [{ type: 'text', text: JSON.stringify(plan, null, 2) }]
        };
      }

      // Safety rule: Mode OFF forbids autonomous proxy handoff
      if (customer.mode === 'OFF' && requestedAction === 'CONTACT_RECIPIENT') {
        const plan = {
          success: false,
          shipmentId: cleanShipmentId,
          recoveryAction: 'ESCALATE',
          nextStep: 'Contact customer directly or route to human support.',
          requiredInformation: [],
          escalationRequired: true,
          reason: 'Customer delivery mode is OFF. Autonomous proxy handoff is unauthorized.'
        };
        recoveryStore[cleanShipmentId] = { ...plan, customerId: cleanCustomerId, status: 'PLAN_CREATED', createdAt: new Date().toISOString() };
        return {
          content: [{ type: 'text', text: JSON.stringify(plan, null, 2) }]
        };
      }

      // Safety rule: Never invent a recipient for proxy handoff
      if (requestedAction === 'CONTACT_RECIPIENT') {
        const hasAuthorized = customer.preferences.some(p => p.authorizationStatus === 'AUTHORIZED');
        if (!hasAuthorized) {
          const plan = {
            success: false,
            shipmentId: cleanShipmentId,
            recoveryAction: 'ESCALATE',
            nextStep: 'Contact customer directly for address or recipient update.',
            requiredInformation: [],
            escalationRequired: true,
            reason: 'No authorized recipient registered in Capability 1. Cannot create proxy handoff.'
          };
          recoveryStore[cleanShipmentId] = { ...plan, customerId: cleanCustomerId, status: 'PLAN_CREATED', createdAt: new Date().toISOString() };
          return {
            content: [{ type: 'text', text: JSON.stringify(plan, null, 2) }]
          };
        }
      }

      // Determine next steps and required information based on requested action
      let nextStep = '';
      let requiredInformation = [];
      let escalationRequired = false;
      let reason = `Recovery plan created for ${requestedAction} in response to ${situation}.`;

      switch (requestedAction) {
        case 'REATTEMPT':
          nextStep = 'Submit reattempt dispatch instruction to carrier logistics connector.';
          requiredInformation = ['targetReattemptDate', 'deliverySlot'];
          break;
        case 'RESCHEDULE':
          nextStep = 'Confirm customer preferred time slot and submit reschedule instruction to carrier.';
          requiredInformation = ['newDeliveryDate', 'newTimeWindow'];
          break;
        case 'CONTACT_RECIPIENT':
          nextStep = 'Coordinate parcel handover with authorized proxy recipient.';
          requiredInformation = ['handoverOtpOrId'];
          break;
        case 'CONTACT_CUSTOMER':
          nextStep = 'Initiate outbound customer voice/SMS outreach for delivery coordination.';
          requiredInformation = [];
          break;
        case 'ESCALATE':
          nextStep = 'Create priority incident ticket for last-mile logistics operations desk.';
          requiredInformation = ['courierRefusalReason', 'trackingId'];
          escalationRequired = true;
          break;
        case 'NO_ACTION':
          nextStep = 'Maintain current delivery tracking monitoring.';
          requiredInformation = [];
          break;
      }

      const planRecord = {
        success: true,
        shipmentId: cleanShipmentId,
        recoveryAction: requestedAction,
        nextStep,
        requiredInformation,
        escalationRequired,
        reason
      };

      // Save in shared in-memory state with status PLAN_CREATED (never claim executed without connector confirmation)
      recoveryStore[cleanShipmentId] = {
        ...planRecord,
        customerId: cleanCustomerId,
        status: 'PLAN_CREATED',
        createdAt: new Date().toISOString()
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(planRecord, null, 2)
          }
        ]
      };
    }
  );

  // Tool 6: get_recovery_status(customerId, shipmentId)
  mcpServer.tool(
    'get_recovery_status',
    'Return current recovery plan and status from shared in-memory state.',
    {
      customerId: z.string().describe('Customer ID (e.g. DEMO001)'),
      shipmentId: z.string().describe('Shipment ID (e.g. SHIP001)')
    },
    async ({ customerId, shipmentId }) => {
      const cleanShipmentId = shipmentId ? shipmentId.trim() : '';
      const plan = recoveryStore[cleanShipmentId];

      if (!plan) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                shipmentId: cleanShipmentId,
                status: 'NO_ACTIVE_PLAN',
                message: `No recovery plan on file for shipment '${cleanShipmentId}'.`
              }, null, 2)
            }
          ]
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              ...plan
            }, null, 2)
          }
        ]
      };
    }
  );

  // ------------------------------------------
  // CAPABILITY 3 TOOLS (Delivery Notifications)
  // ------------------------------------------

  // Tool 7: create_notification(customerId, shipmentId, recipientType, notificationType, message)
  mcpServer.tool(
    'create_notification',
    'Prepare, track, and record a delivery notification request. Status is initialized to PENDING.',
    {
      customerId: z.string().describe('Customer ID (e.g. DEMO001)'),
      shipmentId: z.string().describe('Shipment ID (e.g. SHIP001)'),
      recipientType: z.enum(['CUSTOMER', 'AUTHORIZED_RECIPIENT']).describe('Recipient: CUSTOMER or AUTHORIZED_RECIPIENT'),
      notificationType: z.string().describe('Type: DELIVERY_UPDATE, RECIPIENT_ALERT, ARRIVING_SOON, DELIVERY_FAILED, REATTEMPT_SCHEDULED, RESCHEDULED, DELIVERY_COMPLETED'),
      message: z.string().describe('Notification text')
    },
    async ({ customerId, shipmentId, recipientType, notificationType, message }) => {
      const cleanCustomerId = customerId ? customerId.trim().toUpperCase() : '';
      const cleanShipmentId = shipmentId ? shipmentId.trim() : '';

      const customer = customersStore[cleanCustomerId];
      if (!customer) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: `Customer '${customerId}' not found in Capability 1.`
              })
            }
          ]
        };
      }

      let recipientContact = null;
      let targetRecipientName = customer.customerName || 'Customer';

      // Safety rule: Do not invent recipient contact details. For an authorized recipient, use only Capability 1 data.
      if (recipientType === 'AUTHORIZED_RECIPIENT') {
        const authorizedPref = customer.preferences.find(p => p.authorizationStatus === 'AUTHORIZED');
        if (!authorizedPref) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  error: `No authorized recipient found for customer '${customerId}' in Capability 1. Cannot invent recipient details.`
                })
              }
            ]
          };
        }

        // Mode OFF check
        if (customer.mode === 'OFF') {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  error: 'Customer delivery mode is OFF. Autonomous proxy notification requires explicit customer permission.'
                })
              }
            ]
          };
        }

        recipientContact = authorizedPref.recipientPhone;
        targetRecipientName = authorizedPref.recipientName;
      }

      const notifId = generateNotificationId();
      const notificationRecord = {
        notificationId: notifId,
        customerId: cleanCustomerId,
        shipmentId: cleanShipmentId,
        recipientType,
        targetRecipientName,
        recipientContact,
        notificationType,
        message,
        status: 'PENDING',
        connector: null,
        createdAt: new Date().toISOString()
      };

      notificationsStore.push(notificationRecord);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              notificationId: notifId,
              customerId: cleanCustomerId,
              shipmentId: cleanShipmentId,
              recipientType,
              notificationType,
              message,
              status: 'PENDING'
            }, null, 2)
          }
        ]
      };
    }
  );

  // Tool 8: update_notification_status(notificationId, status, connector, details)
  mcpServer.tool(
    'update_notification_status',
    'Update notification status after external communication connector confirms dispatch.',
    {
      notificationId: z.string().describe('Unique notification identifier (e.g. NOTIF-001)'),
      status: z.enum(['PENDING', 'SENT', 'DELIVERED', 'FAILED']).describe('New status: PENDING, SENT, DELIVERED, FAILED'),
      connector: z.string().describe('Communication connector name confirming the dispatch (e.g. Twilio, WhatsApp-Gateway)'),
      details: z.string().optional().describe('Optional delivery logs or tracking metadata')
    },
    async ({ notificationId, status, connector, details }) => {
      const cleanNotifId = notificationId ? notificationId.trim() : '';

      // Safety rule: agent must only mark SENT or DELIVERED after connector provides confirmation
      if ((status === 'SENT' || status === 'DELIVERED') && (!connector || !connector.trim())) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: `Safety rule violation: Cannot update status to '${status}' without confirmed communication connector.`
              })
            }
          ]
        };
      }

      const notif = notificationsStore.find(n => n.notificationId.toLowerCase() === cleanNotifId.toLowerCase());
      if (!notif) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: `Notification '${notificationId}' not found.`
              })
            }
          ]
        };
      }

      notif.status = status;
      notif.connector = connector.trim();
      notif.details = details || 'Connector confirmation recorded';
      notif.updatedAt = new Date().toISOString();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              notificationId: notif.notificationId,
              status: notif.status,
              connector: notif.connector,
              updatedAt: notif.updatedAt,
              details: notif.details
            }, null, 2)
          }
        ]
      };
    }
  );

  // Tool 9: get_notification_history(customerId, shipmentId)
  mcpServer.tool(
    'get_notification_history',
    'Return chronological notification records for a shipment from shared in-memory state.',
    {
      customerId: z.string().describe('Customer ID (e.g. DEMO001)'),
      shipmentId: z.string().describe('Shipment ID (e.g. SHIP001)')
    },
    async ({ customerId, shipmentId }) => {
      const cleanCustomerId = customerId ? customerId.trim().toUpperCase() : '';
      const cleanShipmentId = shipmentId ? shipmentId.trim() : '';

      const history = notificationsStore
        .filter(n => n.shipmentId.toLowerCase() === cleanShipmentId.toLowerCase() && n.customerId.toUpperCase() === cleanCustomerId)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              customerId: cleanCustomerId,
              shipmentId: cleanShipmentId,
              totalNotifications: history.length,
              history
            }, null, 2)
          }
        ]
      };
    }
  );

  return mcpServer;
}

// Active SSE transports map
const sseTransports = new Map();

/**
 * MCP SSE Transport Endpoint
 * GET /sse
 */
app.get('/sse', async (req, res) => {
  try {
    const mcpServer = createDeliverEaseMcpServer();
    const transport = new SSEServerTransport('/messages', res);
    sseTransports.set(transport.sessionId, transport);

    res.on('close', () => {
      sseTransports.delete(transport.sessionId);
    });

    await mcpServer.connect(transport);
  } catch (err) {
    console.error('Error establishing SSE transport:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error establishing SSE transport' });
    }
  }
});

/**
 * MCP Messages Endpoint
 * POST /messages?sessionId=...
 */
app.post('/messages', async (req, res) => {
  const sessionId = req.query.sessionId;
  if (!sessionId) {
    return res.status(400).json({ error: 'Missing required query parameter: "sessionId".' });
  }

  const transport = sseTransports.get(sessionId);
  if (!transport) {
    return res.status(404).json({ error: `Session not found: '${sessionId}'.` });
  }

  try {
    await transport.handlePostMessage(req, res, req.body);
  } catch (err) {
    console.error('Error handling MCP post message:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal error processing message' });
    }
  }
});

// ==========================================
// REST API Routes
// ==========================================

/**
 * Health Check Endpoint
 * GET /health
 */
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'UP',
    service: 'DeliverEase Mock & MCP Server',
    version: '1.0.0',
    capabilities: [
      'CAPABILITY 1 — Trusted Recipient & Delivery Preferences',
      'CAPABILITY 2 — Delivery Recovery',
      'CAPABILITY 3 — Delivery Notifications'
    ],
    mcp: {
      sseEndpoint: '/sse',
      messagesEndpoint: '/messages',
      toolCount: 9,
      tools: [
        'get_preferences',
        'update_preferences',
        'get_authorized_recipient',
        'get_recovery_options',
        'create_recovery_plan',
        'get_recovery_status',
        'create_notification',
        'update_notification_status',
        'get_notification_history'
      ]
    },
    timestamp: new Date().toISOString()
  });
});

// ------------------------------------------
// REST ROUTES — CAPABILITY 1
// ------------------------------------------

/**
 * 1. GET /api/preferences/:customerId
 */
app.get('/api/preferences/:customerId', (req, res) => {
  const { customerId } = req.params;

  if (!customerId || !customerId.trim()) {
    return res.status(400).json({
      success: false,
      error: 'Invalid or missing customerId parameter.'
    });
  }

  const customer = customersStore[customerId.trim().toUpperCase()];

  if (!customer) {
    return res.status(404).json({
      success: false,
      error: `Customer not found with ID '${customerId}'.`,
      customerId
    });
  }

  return res.status(200).json({
    success: true,
    customerId: customer.customerId,
    mode: customer.mode,
    preferences: customer.preferences
  });
});

/**
 * 2. PUT /api/preferences/:customerId
 */
app.put('/api/preferences/:customerId', (req, res) => {
  const { customerId } = req.params;
  const key = customerId ? customerId.trim().toUpperCase() : '';

  if (!key) {
    return res.status(400).json({
      success: false,
      error: 'Invalid or missing customerId parameter.'
    });
  }

  const existingCustomer = customersStore[key];
  if (!existingCustomer) {
    return res.status(404).json({
      success: false,
      error: `Customer '${customerId}' does not exist. Cannot update preferences for non-existent customer.`
    });
  }

  const { mode, preferences, location, recipientName, recipientRelation, recipientPhone, preferredTime, authorizationStatus } = req.body || {};

  // Validate mode if provided
  if (mode !== undefined) {
    if (typeof mode !== 'string' || !VALID_MODES.includes(mode.trim().toUpperCase())) {
      return res.status(400).json({
        success: false,
        error: `Invalid mode "${mode}". Must be one of: ${VALID_MODES.join(', ')}.`
      });
    }
    existingCustomer.mode = mode.trim().toUpperCase();
  }

  // Preferences array provided
  if (preferences !== undefined) {
    if (!Array.isArray(preferences)) {
      return res.status(400).json({
        success: false,
        error: 'Preferences must be an array of preference objects.'
      });
    }

    for (let i = 0; i < preferences.length; i++) {
      const errorMsg = validatePreferenceItem(preferences[i]);
      if (errorMsg) {
        return res.status(400).json({
          success: false,
          error: `Validation error at preferences[${i}]: ${errorMsg}`
        });
      }
    }

    existingCustomer.preferences = preferences.map(p => ({
      location: p.location.trim(),
      recipientName: p.recipientName ? p.recipientName.trim() : '',
      recipientRelation: p.recipientRelation ? p.recipientRelation.trim() : '',
      recipientPhone: p.recipientPhone ? p.recipientPhone.trim() : '',
      preferredTime: p.preferredTime ? p.preferredTime.trim() : '',
      authorizationStatus: p.authorizationStatus ? p.authorizationStatus.trim().toUpperCase() : 'AUTHORIZED'
    }));
  }
  // Single preference object provided
  else if (location !== undefined) {
    const prefError = validatePreferenceItem(req.body);
    if (prefError) {
      return res.status(400).json({
        success: false,
        error: prefError
      });
    }

    const normLocation = location.trim();
    const existingIndex = existingCustomer.preferences.findIndex(
      p => p.location.toLowerCase() === normLocation.toLowerCase()
    );

    const updatedPref = {
      location: normLocation,
      recipientName: recipientName !== undefined ? String(recipientName).trim() : (existingIndex >= 0 ? existingCustomer.preferences[existingIndex].recipientName : ''),
      recipientRelation: recipientRelation !== undefined ? String(recipientRelation).trim() : (existingIndex >= 0 ? existingCustomer.preferences[existingIndex].recipientRelation : ''),
      recipientPhone: recipientPhone !== undefined ? String(recipientPhone).trim() : (existingIndex >= 0 ? existingCustomer.preferences[existingIndex].recipientPhone : ''),
      preferredTime: preferredTime !== undefined ? String(preferredTime).trim() : (existingIndex >= 0 ? existingCustomer.preferences[existingIndex].preferredTime : ''),
      authorizationStatus: authorizationStatus !== undefined ? String(authorizationStatus).trim().toUpperCase() : (existingIndex >= 0 ? existingCustomer.preferences[existingIndex].authorizationStatus : 'AUTHORIZED')
    };

    if (existingIndex >= 0) {
      existingCustomer.preferences[existingIndex] = updatedPref;
    } else {
      existingCustomer.preferences.push(updatedPref);
    }
  }

  if (mode === undefined && preferences === undefined && location === undefined) {
    return res.status(400).json({
      success: false,
      error: 'Request body must contain "mode", "preferences" array, or a preference object with "location".'
    });
  }

  return res.status(200).json({
    success: true,
    message: 'Customer preferences updated successfully.',
    customerId: existingCustomer.customerId,
    mode: existingCustomer.mode,
    preferences: existingCustomer.preferences
  });
});

/**
 * 3. GET /api/recipient
 */
app.get('/api/recipient', (req, res) => {
  const { customerId, location } = req.query;

  if (!customerId || !customerId.trim()) {
    return res.status(400).json({
      success: false,
      error: 'Missing required query parameter: "customerId" is required.'
    });
  }

  if (!location || !location.trim()) {
    return res.status(400).json({
      success: false,
      error: 'Missing required query parameter: "location" is required.'
    });
  }

  const cleanCustomerId = customerId.trim().toUpperCase();
  const cleanLocation = location.trim();

  const customer = customersStore[cleanCustomerId];
  if (!customer) {
    return res.status(404).json({
      success: false,
      authorizationStatus: 'NOT_AUTHORIZED',
      error: `Customer not found with ID '${customerId}'.`,
      customerId: cleanCustomerId,
      location: cleanLocation
    });
  }

  if (customer.mode === 'OFF') {
    return res.status(200).json({
      success: true,
      customerId: customer.customerId,
      location: cleanLocation,
      mode: customer.mode,
      authorizationStatus: 'NOT_AUTHORIZED',
      recipient: null,
      message: 'Proxy recipient delivery is disabled because customer delivery mode is set to OFF.'
    });
  }

  const matchedPref = customer.preferences.find(
    p => p.location.trim().toLowerCase() === cleanLocation.toLowerCase()
  );

  if (!matchedPref || matchedPref.authorizationStatus !== 'AUTHORIZED') {
    return res.status(200).json({
      success: true,
      customerId: customer.customerId,
      location: cleanLocation,
      mode: customer.mode,
      authorizationStatus: 'NOT_AUTHORIZED',
      recipient: null,
      message: `No authorized recipient found for location "${cleanLocation}".`
    });
  }

  return res.status(200).json({
    success: true,
    customerId: customer.customerId,
    location: matchedPref.location,
    mode: customer.mode,
    authorizationStatus: 'AUTHORIZED',
    recipientName: matchedPref.recipientName,
    recipientRelation: matchedPref.recipientRelation,
    recipientPhone: matchedPref.recipientPhone,
    preferredTime: matchedPref.preferredTime,
    recipient: {
      name: matchedPref.recipientName,
      relation: matchedPref.recipientRelation,
      phone: matchedPref.recipientPhone,
      preferredTime: matchedPref.preferredTime
    }
  });
});

// ------------------------------------------
// REST ROUTES — CAPABILITY 2 (Delivery Recovery)
// ------------------------------------------

/**
 * POST /api/recovery/options
 * Evaluate recovery actions
 */
app.post('/api/recovery/options', (req, res) => {
  const { customerId, shipmentId, situation } = req.body || {};
  if (!customerId || !shipmentId) {
    return res.status(400).json({ success: false, error: 'customerId and shipmentId are required.' });
  }

  const customer = customersStore[customerId.trim().toUpperCase()];
  if (!customer) {
    return res.status(404).json({
      shipmentId,
      situation: situation || 'UNKNOWN',
      availableActions: ['ESCALATE'],
      recommendedAction: 'ESCALATE',
      reason: `Customer '${customerId}' not found.`,
      escalationRequired: true
    });
  }

  const options = evaluateRecoveryOptions(customer, shipmentId.trim(), situation);
  return res.status(200).json({ success: true, ...options });
});

/**
 * POST /api/recovery/plan
 * Create a recovery plan
 */
app.post('/api/recovery/plan', (req, res) => {
  const { customerId, shipmentId, situation, requestedAction } = req.body || {};
  if (!customerId || !shipmentId || !requestedAction) {
    return res.status(400).json({ success: false, error: 'customerId, shipmentId, and requestedAction are required.' });
  }

  if (!ALLOWED_RECOVERY_ACTIONS.includes(requestedAction)) {
    return res.status(400).json({ success: false, error: `Invalid requestedAction. Must be one of: ${ALLOWED_RECOVERY_ACTIONS.join(', ')}` });
  }

  const cleanCustomerId = customerId.trim().toUpperCase();
  const cleanShipmentId = shipmentId.trim();
  const customer = customersStore[cleanCustomerId];

  if (!customer) {
    return res.status(404).json({ success: false, error: `Customer '${customerId}' not found.` });
  }

  // Safety rule: Missing required information => ESCALATE
  const normSit = (situation || '').trim().toLowerCase();
  if (!normSit || normSit.includes('missing') || normSit === 'unknown') {
    const plan = {
      success: false,
      shipmentId: cleanShipmentId,
      recoveryAction: 'ESCALATE',
      nextStep: 'Obtain missing delivery details from carrier or human operations.',
      requiredInformation: ['missing_delivery_details'],
      escalationRequired: true,
      reason: 'Required delivery information is missing. Plan cannot proceed autonomously.'
    };
    recoveryStore[cleanShipmentId] = { ...plan, customerId: cleanCustomerId, status: 'PLAN_CREATED', createdAt: new Date().toISOString() };
    return res.status(200).json(plan);
  }

  // Safety rule: Mode OFF forbids autonomous proxy handoff
  if (customer.mode === 'OFF' && requestedAction === 'CONTACT_RECIPIENT') {
    const plan = {
      success: false,
      shipmentId: cleanShipmentId,
      recoveryAction: 'ESCALATE',
      nextStep: 'Contact customer directly or route to human support.',
      requiredInformation: [],
      escalationRequired: true,
      reason: 'Customer delivery mode is OFF. Autonomous proxy handoff is unauthorized.'
    };
    recoveryStore[cleanShipmentId] = { ...plan, customerId: cleanCustomerId, status: 'PLAN_CREATED', createdAt: new Date().toISOString() };
    return res.status(200).json(plan);
  }

  let nextStep = 'Proceed with recovery action.';
  let requiredInformation = [];
  let escalationRequired = requestedAction === 'ESCALATE';

  if (requestedAction === 'REATTEMPT') {
    nextStep = 'Submit reattempt dispatch instruction to carrier logistics connector.';
    requiredInformation = ['targetReattemptDate', 'deliverySlot'];
  } else if (requestedAction === 'RESCHEDULE') {
    nextStep = 'Confirm customer preferred time slot and submit reschedule instruction to carrier.';
    requiredInformation = ['newDeliveryDate', 'newTimeWindow'];
  } else if (requestedAction === 'CONTACT_RECIPIENT') {
    nextStep = 'Coordinate parcel handover with authorized proxy recipient.';
    requiredInformation = ['handoverOtpOrId'];
  } else if (requestedAction === 'CONTACT_CUSTOMER') {
    nextStep = 'Initiate outbound customer voice/SMS outreach for delivery coordination.';
  } else if (requestedAction === 'ESCALATE') {
    nextStep = 'Create priority incident ticket for last-mile logistics operations desk.';
    requiredInformation = ['courierRefusalReason', 'trackingId'];
  }

  const planRecord = {
    success: true,
    shipmentId: cleanShipmentId,
    recoveryAction: requestedAction,
    nextStep,
    requiredInformation,
    escalationRequired,
    reason: `Recovery plan created for ${requestedAction} in response to ${situation}.`
  };

  recoveryStore[cleanShipmentId] = {
    ...planRecord,
    customerId: cleanCustomerId,
    status: 'PLAN_CREATED',
    createdAt: new Date().toISOString()
  };

  return res.status(200).json(planRecord);
});

/**
 * GET /api/recovery/status/:shipmentId
 */
app.get('/api/recovery/status/:shipmentId', (req, res) => {
  const { shipmentId } = req.params;
  const plan = recoveryStore[shipmentId.trim()];

  if (!plan) {
    return res.status(404).json({
      success: false,
      shipmentId,
      status: 'NO_ACTIVE_PLAN',
      message: `No recovery plan on file for shipment '${shipmentId}'.`
    });
  }

  return res.status(200).json({ success: true, ...plan });
});

// ------------------------------------------
// REST ROUTES — CAPABILITY 3 (Delivery Notifications)
// ------------------------------------------

/**
 * POST /api/notifications
 * Create a delivery notification
 */
app.post('/api/notifications', (req, res) => {
  const { customerId, shipmentId, recipientType, notificationType, message } = req.body || {};
  if (!customerId || !shipmentId || !recipientType || !notificationType || !message) {
    return res.status(400).json({ success: false, error: 'customerId, shipmentId, recipientType, notificationType, and message are required.' });
  }

  const cleanCustomerId = customerId.trim().toUpperCase();
  const customer = customersStore[cleanCustomerId];
  if (!customer) {
    return res.status(404).json({ success: false, error: `Customer '${customerId}' not found in Capability 1.` });
  }

  if (!['CUSTOMER', 'AUTHORIZED_RECIPIENT'].includes(recipientType)) {
    return res.status(400).json({ success: false, error: 'recipientType must be CUSTOMER or AUTHORIZED_RECIPIENT.' });
  }

  let recipientContact = null;
  let targetRecipientName = customer.customerName || 'Customer';

  if (recipientType === 'AUTHORIZED_RECIPIENT') {
    const authorizedPref = customer.preferences.find(p => p.authorizationStatus === 'AUTHORIZED');
    if (!authorizedPref) {
      return res.status(400).json({
        success: false,
        error: `No authorized recipient found for customer '${customerId}' in Capability 1. Cannot invent recipient details.`
      });
    }

    if (customer.mode === 'OFF') {
      return res.status(403).json({
        success: false,
        error: 'Customer delivery mode is OFF. Autonomous proxy notification requires explicit customer permission.'
      });
    }

    recipientContact = authorizedPref.recipientPhone;
    targetRecipientName = authorizedPref.recipientName;
  }

  const notifId = generateNotificationId();
  const notificationRecord = {
    notificationId: notifId,
    customerId: cleanCustomerId,
    shipmentId: shipmentId.trim(),
    recipientType,
    targetRecipientName,
    recipientContact,
    notificationType,
    message,
    status: 'PENDING',
    connector: null,
    createdAt: new Date().toISOString()
  };

  notificationsStore.push(notificationRecord);

  return res.status(201).json({
    notificationId: notifId,
    customerId: cleanCustomerId,
    shipmentId: shipmentId.trim(),
    recipientType,
    notificationType,
    message,
    status: 'PENDING'
  });
});

/**
 * PUT /api/notifications/:notificationId
 * Update notification status after connector confirmation
 */
app.put('/api/notifications/:notificationId', (req, res) => {
  const { notificationId } = req.params;
  const { status, connector, details } = req.body || {};

  if (!status || !ALLOWED_NOTIFICATION_STATUSES.includes(status)) {
    return res.status(400).json({ success: false, error: `Invalid status. Must be one of: ${ALLOWED_NOTIFICATION_STATUSES.join(', ')}` });
  }

  // Safety rule: Cannot mark SENT or DELIVERED without connector confirmation
  if ((status === 'SENT' || status === 'DELIVERED') && (!connector || !connector.trim())) {
    return res.status(400).json({
      success: false,
      error: `Safety rule violation: Cannot update status to '${status}' without confirmed communication connector.`
    });
  }

  const notif = notificationsStore.find(n => n.notificationId.toLowerCase() === notificationId.trim().toLowerCase());
  if (!notif) {
    return res.status(404).json({ success: false, error: `Notification '${notificationId}' not found.` });
  }

  notif.status = status;
  notif.connector = connector ? connector.trim() : notif.connector;
  notif.details = details || 'Connector confirmation recorded';
  notif.updatedAt = new Date().toISOString();

  return res.status(200).json({
    success: true,
    notificationId: notif.notificationId,
    status: notif.status,
    connector: notif.connector,
    updatedAt: notif.updatedAt,
    details: notif.details
  });
});

/**
 * GET /api/notifications/:shipmentId
 * Query chronological notification history
 */
app.get('/api/notifications/:shipmentId', (req, res) => {
  const { shipmentId } = req.params;
  const customerId = req.query.customerId ? req.query.customerId.trim().toUpperCase() : 'DEMO001';

  const history = notificationsStore
    .filter(n => n.shipmentId.toLowerCase() === shipmentId.trim().toLowerCase() && n.customerId.toUpperCase() === customerId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  return res.status(200).json({
    success: true,
    customerId,
    shipmentId: shipmentId.trim(),
    totalNotifications: history.length,
    history
  });
});

/**
 * Reset Demo Data Helper (Hackathon utility)
 * POST /api/reset
 */
app.post('/api/reset', (req, res) => {
  customersStore = getInitialSeedData();
  recoveryStore = getInitialRecoveryData();
  notificationsStore = getInitialNotificationsData();
  notificationCounter = 1;

  res.status(200).json({
    success: true,
    message: 'All 3 DeliverEase capabilities reset to initial demo state.',
    customers: Object.keys(customersStore),
    recoveryShipments: Object.keys(recoveryStore),
    totalNotifications: notificationsStore.length
  });
});

// ==========================================
// 404 & Central Error Handling
// ==========================================
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Cannot ${req.method} ${req.path}. Endpoint not found.`,
    availableEndpoints: [
      'GET /health',
      'GET /sse (MCP SSE connection)',
      'POST /messages?sessionId=... (MCP messages)',
      'GET /api/preferences/:customerId',
      'PUT /api/preferences/:customerId',
      'GET /api/recipient?customerId=...&location=...',
      'POST /api/recovery/options',
      'POST /api/recovery/plan',
      'GET /api/recovery/status/:shipmentId',
      'POST /api/notifications',
      'PUT /api/notifications/:notificationId',
      'GET /api/notifications/:shipmentId',
      'POST /api/reset'
    ]
  });
});

app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal Server Error',
    message: err.message || 'An unexpected error occurred.'
  });
});

// ==========================================
// Server Start
// ==========================================
if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`===================================================`);
    console.log(`🚀 DeliverEase Mock & MCP Server running at http://${HOST}:${PORT}`);
    console.log(`📡 Health Check : http://${HOST}:${PORT}/health`);
    console.log(`🔌 MCP SSE      : http://${HOST}:${PORT}/sse`);
    console.log(`💬 MCP Messages : http://${HOST}:${PORT}/messages`);
    console.log(`📦 Capabilities : 3 Capabilities Active`);
    console.log(`   1. Trusted Recipient & Delivery Preferences`);
    console.log(`   2. Delivery Recovery`);
    console.log(`   3. Delivery Notifications`);
    console.log(`🛠️  MCP Tools   : 9 Registered Tools`);
    console.log(`📋 Demo Customer: DEMO001 (Home, Hostel, Office)`);
    console.log(`===================================================`);
  });
}

module.exports = app;
