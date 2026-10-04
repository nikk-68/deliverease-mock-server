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
// In-Memory Data Stores & Seed Data
// ==========================================
const VALID_MODES = ['ACTIVE', 'ASSIST', 'OFF'];
const VALID_AUTH_STATUSES = ['AUTHORIZED', 'NOT_AUTHORIZED'];

const getInitialSeedCustomers = () => ({
  DEMO001: {
    customerId: 'DEMO001',
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
        recipientName: 'Aarav Sharma',
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

const getInitialSeedShipments = () => ({
  SHIP001: {
    shipmentId: 'SHIP001',
    customerId: 'DEMO001',
    location: 'Home',
    status: 'OUT_FOR_DELIVERY',
    courierPartner: 'ExpressLogistics',
    trackingNumber: 'EXP-889102'
  },
  SHIP002: {
    shipmentId: 'SHIP002',
    customerId: 'DEMO001',
    location: 'Office',
    status: 'OUT_FOR_DELIVERY',
    courierPartner: 'FastTrack',
    trackingNumber: 'FT-441209'
  }
});

const getInitialSeedTimeline = () => ([
  {
    eventId: 'EVT-SHIP001-01',
    timestamp: '2026-10-04T07:30:00.000Z',
    customerId: 'DEMO001',
    shipmentId: 'SHIP001',
    eventType: 'SHIPMENT_RECEIVED',
    details: { note: 'Package received at regional hub', location: 'Hub North' }
  },
  {
    eventId: 'EVT-SHIP001-02',
    timestamp: '2026-10-04T08:15:00.000Z',
    customerId: 'DEMO001',
    shipmentId: 'SHIP001',
    eventType: 'PREFERENCE_EVALUATED',
    details: { location: 'Home', mode: 'ACTIVE', recipient: 'Sunita Sharma (Mummy)' }
  },
  {
    eventId: 'EVT-SHIP001-03',
    timestamp: '2026-10-04T09:00:00.000Z',
    customerId: 'DEMO001',
    shipmentId: 'SHIP001',
    eventType: 'OUT_FOR_DELIVERY',
    details: { courierName: 'Vikram Singh', vehicle: 'Two-Wheeler' }
  },
  {
    eventId: 'EVT-SHIP002-01',
    timestamp: '2026-10-04T08:00:00.000Z',
    customerId: 'DEMO001',
    shipmentId: 'SHIP002',
    eventType: 'SHIPMENT_RECEIVED',
    details: { note: 'Package received at city hub', location: 'Hub South' }
  },
  {
    eventId: 'EVT-SHIP002-02',
    timestamp: '2026-10-04T08:45:00.000Z',
    customerId: 'DEMO001',
    shipmentId: 'SHIP002',
    eventType: 'PREFERENCE_EVALUATED',
    details: { location: 'Office', mode: 'ACTIVE', recipient: 'Ramesh Kumar (Security Desk)' }
  }
]);

let customersStore = getInitialSeedCustomers();
let shipmentsStore = getInitialSeedShipments();
let deliveryTimelineStore = getInitialSeedTimeline();

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

// ==========================================
// Capability 2: Mode & Policy Logic
// ==========================================
function evaluateModePolicy(customer) {
  switch (customer.mode) {
    case 'ACTIVE':
      return {
        customerId: customer.customerId,
        currentMode: 'ACTIVE',
        autonomousActionsAllowed: true,
        interventionTrigger: 'AUTONOMOUS_COORDINATION',
        proxyHandoffAllowed: true,
        explanation: 'Agent may autonomously coordinate delivery within saved permissions, contact/coordinate with courier and authorized recipient without interrupting customer.'
      };
    case 'ASSIST':
      return {
        customerId: customer.customerId,
        currentMode: 'ASSIST',
        autonomousActionsAllowed: false,
        interventionTrigger: 'CUSTOMER_UNAVAILABLE_OR_UNRESPONSIVE',
        proxyHandoffAllowed: true,
        explanation: 'Customer remains primary receiver. Agent may intervene only when customer is unavailable, unreachable, or unresponsive. Proactive handover is blocked until Assist rule is triggered.'
      };
    case 'OFF':
    default:
      return {
        customerId: customer.customerId,
        currentMode: 'OFF',
        autonomousActionsAllowed: false,
        interventionTrigger: 'NONE_DISABLED',
        proxyHandoffAllowed: false,
        explanation: 'Agent must not autonomously coordinate handoff or proxy receipt. Can only provide delivery status/information to customer; proxy delegation is disabled.'
      };
  }
}

function evaluateActionDecision(customer, situation) {
  if (!situation || typeof situation !== 'string' || !situation.trim()) {
    return {
      decision: 'ESCALATE',
      reason: 'Missing situation information. DeliverEase safety rules prohibit guessing missing context.',
      allowedActions: ['request_clarification'],
      blockedActions: ['autonomous_action'],
      currentMode: customer.mode,
      situation: ''
    };
  }

  const s = situation.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const mode = customer.mode;

  // Case 1: Customer is available
  if (s === 'customer_available') {
    return {
      decision: 'ALLOW',
      reason: 'Customer is available for direct delivery handover.',
      allowedActions: ['direct_customer_delivery', 'request_delivery_confirmation'],
      blockedActions: [],
      currentMode: mode,
      situation
    };
  }

  // Case 2: Customer is unavailable or phone is silent
  if (s === 'customer_unavailable' || s === 'phone_silent') {
    if (mode === 'ACTIVE') {
      return {
        decision: 'ALLOW',
        reason: 'Customer is unavailable. Mode ACTIVE permits autonomous coordination with registered proxy recipient.',
        allowedActions: ['contact_authorized_recipient', 'coordinate_proxy_handoff', 'record_audit_event'],
        blockedActions: [],
        currentMode: mode,
        situation
      };
    } else if (mode === 'ASSIST') {
      return {
        decision: 'ALLOW_WITH_ASSIST',
        reason: 'Assist rule triggered: customer is unavailable or unresponsive. Agent is authorized to engage proxy recipient.',
        allowedActions: ['verify_customer_unreachable', 'contact_authorized_recipient', 'notify_customer_of_handoff'],
        blockedActions: ['silent_unnotified_handoff'],
        currentMode: mode,
        situation
      };
    } else {
      return {
        decision: 'DENY',
        reason: 'Customer is unavailable and delivery mode is OFF. Proxy delegation is prohibited.',
        allowedActions: ['notify_customer_status', 'record_delivery_attempt'],
        blockedActions: ['coordinate_proxy_handoff', 'delegate_to_proxy'],
        currentMode: mode,
        situation
      };
    }
  }

  // Case 3: Authorized recipient is available
  if (s === 'authorized_recipient_available') {
    if (mode === 'ACTIVE') {
      return {
        decision: 'ALLOW',
        reason: 'Authorized recipient is available at delivery location under ACTIVE mode.',
        allowedActions: ['coordinate_proxy_handoff', 'verify_recipient_id', 'complete_handover_with_connector'],
        blockedActions: [],
        currentMode: mode,
        situation
      };
    } else if (mode === 'ASSIST') {
      return {
        decision: 'ALLOW_WITH_ASSIST',
        reason: 'Recipient is available; Assist mode permits handover provided customer was confirmed unreachable.',
        allowedActions: ['confirm_customer_nonresponse', 'coordinate_proxy_handoff', 'send_handoff_notification'],
        blockedActions: ['unconditional_bypass_of_customer'],
        currentMode: mode,
        situation
      };
    } else {
      return {
        decision: 'DENY',
        reason: 'Delivery mode is set to OFF. Proxy receipt is prohibited even if authorized recipient is available.',
        allowedActions: ['deliver_to_customer_only'],
        blockedActions: ['handoff_to_proxy'],
        currentMode: mode,
        situation
      };
    }
  }

  // Case 4: Recipient is unavailable
  if (s === 'recipient_unavailable' || s === 'authorized_recipient_unavailable') {
    return {
      decision: 'ESCALATE',
      reason: 'Authorized recipient is unavailable. DeliverEase safety rules prohibit inventing recipients or leaving parcel unattended.',
      allowedActions: ['notify_customer', 'initiate_rescheduling', 'record_escalation_event'],
      blockedActions: ['unauthorized_handoff', 'leave_unattended'],
      currentMode: mode,
      situation
    };
  }

  // Case 5: Delivery attempt failed
  if (s === 'delivery_failed' || s === 'delivery_attempt_failed') {
    return {
      decision: 'ESCALATE',
      reason: 'Delivery attempt failed. Requires exception logging, root-cause recording, and carrier reattempt plan.',
      allowedActions: ['record_failure_event', 'notify_parties', 'create_resolution_plan'],
      blockedActions: ['claim_delivery_completed'],
      currentMode: mode,
      situation
    };
  }

  // Case 6: Courier access issues
  if (s.includes('cannot_access') || s.includes('access_location')) {
    return {
      decision: 'ESCALATE',
      reason: 'Courier cannot physically access delivery location (gate, security, or building entrance).',
      allowedActions: ['contact_building_security', 'request_gate_pass_code', 'contact_customer'],
      blockedActions: ['abandon_delivery'],
      currentMode: mode,
      situation
    };
  }

  // Case 7: Courier refuses handoff
  if (s.includes('refuses_handoff') || s.includes('courier_refuses')) {
    return {
      decision: 'ESCALATE',
      reason: 'Courier requires additional authorization verification before releasing parcel to proxy recipient.',
      allowedActions: ['provide_verification_otp', 'bridge_voice_call_with_customer', 'contact_dispatch'],
      blockedActions: ['force_handoff'],
      currentMode: mode,
      situation
    };
  }

  // Fallback for Ambiguous / Missing Situation
  return {
    decision: 'ESCALATE',
    reason: `Ambiguous or unrecognized situation "${situation}". DeliverEase safety policy prohibits guessing missing context.`,
    allowedActions: ['request_clarification', 'halt_autonomous_action'],
    blockedActions: ['autonomous_delegation', 'claim_completion'],
    currentMode: mode,
    situation
  };
}

// ==========================================
// Capability 3: Escalation & Resolution Plan Logic
// ==========================================
function buildResolutionPlan(customerId, shipmentId, situation, customer) {
  const s = (situation || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const mode = customer ? customer.mode : 'ACTIVE';

  if (!situation || !situation.trim()) {
    return {
      resolutionType: 'ESCALATE_MISSING_DATA',
      priority: 'CRITICAL',
      nextRecommendedAction: 'Halt autonomous action and request missing situation parameters.',
      requiredInformation: ['situation_clarification'],
      escalationRequired: true,
      explanation: 'Safety rule enforced: DeliverEase never guesses missing information. Ambiguous situations must escalate.'
    };
  }

  if (s === 'authorized_recipient_unavailable' || s === 'recipient_unavailable') {
    return {
      resolutionType: 'REATTEMPT_WITH_SECONDARY_CONTACT',
      priority: 'HIGH',
      nextRecommendedAction: 'Contact customer directly for alternative instructions or schedule delivery reattempt during preferred window.',
      requiredInformation: ['customer_alternative_preference', 'reattempt_time_window'],
      escalationRequired: true,
      explanation: 'Authorized recipient was unreachable or not present at designated location. Cannot invent another recipient.'
    };
  }

  if (s === 'customer_unavailable') {
    if (mode === 'ACTIVE') {
      return {
        resolutionType: 'DELEGATE_TO_AUTHORIZED_RECIPIENT',
        priority: 'MEDIUM',
        nextRecommendedAction: 'Route delivery handover to verified authorized proxy recipient for current location.',
        requiredInformation: ['verified_location', 'recipient_readiness_confirmation'],
        escalationRequired: false,
        explanation: 'Customer is unavailable, but delivery mode is ACTIVE with saved proxy recipient permissions.'
      };
    } else if (mode === 'ASSIST') {
      return {
        resolutionType: 'ASSIST_TRIGGERED_PROXY_DELEGATION',
        priority: 'MEDIUM',
        nextRecommendedAction: 'Engage authorized recipient after logging customer non-response; send notification to customer.',
        requiredInformation: ['customer_notification_dispatch', 'recipient_readiness'],
        escalationRequired: false,
        explanation: 'Assist mode triggered due to primary customer non-response.'
      };
    } else {
      return {
        resolutionType: 'SCHEDULE_REATTEMPT_DIRECT_ONLY',
        priority: 'HIGH',
        nextRecommendedAction: 'Hold shipment at delivery hub and schedule direct customer reattempt when customer is reachable. Proxy handoff is disabled.',
        requiredInformation: ['customer_availability_slot'],
        escalationRequired: true,
        explanation: 'Customer delivery mode is OFF. Delegation to proxy is prohibited.'
      };
    }
  }

  if (s.includes('cannot_access') || s.includes('access_location')) {
    return {
      resolutionType: 'GATE_ACCESS_COORDINATION',
      priority: 'HIGH',
      nextRecommendedAction: 'Contact building security/gate or authorized recipient to grant courier physical entrance.',
      requiredInformation: ['gate_pass_code', 'building_security_contact'],
      escalationRequired: true,
      explanation: 'Courier is physically blocked from reaching the doorstep or designated delivery point.'
    };
  }

  if (s.includes('refuses_handoff') || s.includes('courier_refuses')) {
    return {
      resolutionType: 'OTP_OR_ID_VERIFICATION_SUPPORT',
      priority: 'CRITICAL',
      nextRecommendedAction: 'Provide courier with verified authorization token, OTP, or direct voice bridge with customer to validate proxy identity.',
      requiredInformation: ['delivery_otp', 'government_id_type_for_proxy'],
      escalationRequired: true,
      explanation: 'Courier requires official courier policy verification before handing parcel to authorized recipient.'
    };
  }

  if (s.includes('delivery_failed') || s === 'delivery_attempt_failed') {
    return {
      resolutionType: 'FAILED_ATTEMPT_RECOVERY',
      priority: 'HIGH',
      nextRecommendedAction: 'Log failed attempt reason in audit timeline and arrange carrier next-day slot or pickup point redirect.',
      requiredInformation: ['carrier_failure_code', 'customer_reschedule_preference'],
      escalationRequired: true,
      explanation: 'Delivery attempt failed without handover. Safety rules prohibit claiming completion.'
    };
  }

  if (s.includes('reattempt') || s.includes('rescheduling')) {
    return {
      resolutionType: 'SCHEDULED_REATTEMPT',
      priority: 'MEDIUM',
      nextRecommendedAction: "Reserve courier reattempt window matching customer's preferred delivery time.",
      requiredInformation: ['rescheduled_date', 'preferred_time_slot'],
      escalationRequired: false,
      explanation: 'Coordination plan created for rescheduled delivery attempt.'
    };
  }

  if (s.includes('connector') || s.includes('tool_failure')) {
    return {
      resolutionType: 'CARRIER_SYSTEM_FALLBACK',
      priority: 'CRITICAL',
      nextRecommendedAction: 'Fallback to direct carrier phone helpline or manual dispatch; log connector failure event in timeline.',
      requiredInformation: ['carrier_dispatch_ticket_id'],
      escalationRequired: true,
      explanation: 'Safety rule enforced: Never claim SMS/call/update succeeded without connector confirmation.'
    };
  }

  // Default Ambiguous Situation
  return {
    resolutionType: 'ESCALATE_UNKNOWN_SITUATION',
    priority: 'HIGH',
    nextRecommendedAction: 'Halt autonomous actions and route case to customer coordination agent.',
    requiredInformation: ['operational_clarification'],
    escalationRequired: true,
    explanation: 'Missing or ambiguous information must produce ESCALATE to ensure delivery integrity.'
  };
}

// ==========================================
// MCP (Model Context Protocol) Server & Tools
// ==========================================
function createDeliverEaseMcpServer() {
  const mcpServer = new McpServer({
    name: 'deliverease-mcp-server',
    version: '2.0.0'
  });

  // ------------------------------------------
  // CAPABILITY 1 TOOLS
  // ------------------------------------------

  // 1. get_preferences
  mcpServer.tool(
    'get_preferences',
    'Retrieve customer delivery mode (ACTIVE | ASSIST | OFF) and saved location preferences.',
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

  // 2. update_preferences
  mcpServer.tool(
    'update_preferences',
    'Update delivery mode (ACTIVE, ASSIST, OFF) for a customer.',
    {
      customerId: z.string().describe('Customer identifier (e.g. DEMO001)'),
      mode: z.enum(['ACTIVE', 'ASSIST', 'OFF']).describe('Delivery mode: ACTIVE, ASSIST, or OFF')
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

  // 3. get_authorized_recipient
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

      // Location match
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

      // Authorized recipient response - only necessary coordination data
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
  // CAPABILITY 2 TOOLS
  // ------------------------------------------

  // 4. get_mode_policy
  mcpServer.tool(
    'get_mode_policy',
    'Return customer current delivery mode policy, autonomous action permissions, intervention triggers, and handoff allowances.',
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
                error: `Customer not found with ID '${customerId}'.`
              })
            }
          ]
        };
      }

      const policy = evaluateModePolicy(customer);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(policy, null, 2)
          }
        ]
      };
    }
  );

  // 5. evaluate_delivery_action
  mcpServer.tool(
    'evaluate_delivery_action',
    'Evaluate delivery situation against customer mode policy to determine if action is ALLOW, ALLOW_WITH_ASSIST, DENY, or ESCALATE.',
    {
      customerId: z.string().describe('Customer identifier (e.g. DEMO001)'),
      situation: z.string().describe('Delivery situation (e.g. customer_unavailable, customer_available, phone_silent, authorized_recipient_available, recipient_unavailable, delivery_failed)')
    },
    async ({ customerId, situation }) => {
      const key = customerId ? customerId.trim().toUpperCase() : '';
      const customer = customersStore[key];
      if (!customer) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                decision: 'ESCALATE',
                reason: `Customer not found with ID '${customerId}'. Cannot guess policy for unknown customer.`,
                allowedActions: ['verify_customer_registration'],
                blockedActions: ['autonomous_action']
              })
            }
          ]
        };
      }

      const evaluation = evaluateActionDecision(customer, situation);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(evaluation, null, 2)
          }
        ]
      };
    }
  );

  // ------------------------------------------
  // CAPABILITY 3 TOOLS
  // ------------------------------------------

  // 6. create_resolution_plan
  mcpServer.tool(
    'create_resolution_plan',
    'Create structured resolution plan for delivery exceptions and non-standard situations without directly executing courier actions.',
    {
      customerId: z.string().describe('Customer identifier (e.g. DEMO001)'),
      shipmentId: z.string().describe('Shipment tracking identifier (e.g. SHIP001, SHIP002)'),
      situation: z.string().describe('Exception situation description')
    },
    async ({ customerId, shipmentId, situation }) => {
      const key = customerId ? customerId.trim().toUpperCase() : '';
      const customer = customersStore[key];
      const plan = buildResolutionPlan(customerId, shipmentId, situation, customer);

      // Record event in timeline
      const eventId = `EVT-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      deliveryTimelineStore.push({
        eventId,
        timestamp: new Date().toISOString(),
        customerId: key || customerId,
        shipmentId: shipmentId.toUpperCase(),
        eventType: 'RESOLUTION_PLAN_CREATED',
        details: {
          situation,
          resolutionType: plan.resolutionType,
          priority: plan.priority,
          escalationRequired: plan.escalationRequired
        }
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(plan, null, 2)
          }
        ]
      };
    }
  );

  // 7. record_delivery_event
  mcpServer.tool(
    'record_delivery_event',
    'Store a timestamped delivery decision or coordination event in the immutable in-memory audit timeline.',
    {
      customerId: z.string().describe('Customer identifier (e.g. DEMO001)'),
      shipmentId: z.string().describe('Shipment identifier (e.g. SHIP001)'),
      eventType: z.string().describe('Event category (e.g. ACTION_EVALUATED, COURIER_CONTACTED, HANDOFF_ATTEMPTED)'),
      details: z.record(z.any()).describe('Event details and metadata')
    },
    async ({ customerId, shipmentId, eventType, details }) => {
      // Safety rule check: Never claim delivery completed without connector confirmation
      const upperEventType = eventType.trim().toUpperCase();
      if (upperEventType === 'DELIVERY_COMPLETED' && (!details || !details.connectorConfirmation)) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: 'Safety Rule Violation: Cannot claim delivery completed without verified connector confirmation.'
              })
            }
          ]
        };
      }

      const eventId = `EVT-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      const newEvent = {
        eventId,
        timestamp: new Date().toISOString(),
        customerId: customerId.trim().toUpperCase(),
        shipmentId: shipmentId.trim().toUpperCase(),
        eventType: upperEventType,
        details: details || {}
      };

      deliveryTimelineStore.push(newEvent);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: 'Delivery event recorded in audit timeline.',
              event: newEvent
            }, null, 2)
          }
        ]
      };
    }
  );

  // 8. get_delivery_timeline
  mcpServer.tool(
    'get_delivery_timeline',
    'Return chronological delivery decision and event history for a customer shipment.',
    {
      customerId: z.string().describe('Customer identifier (e.g. DEMO001)'),
      shipmentId: z.string().describe('Shipment identifier (e.g. SHIP001, SHIP002)')
    },
    async ({ customerId, shipmentId }) => {
      const cleanCustomerId = customerId.trim().toUpperCase();
      const cleanShipmentId = shipmentId.trim().toUpperCase();

      const events = deliveryTimelineStore
        .filter(e => e.shipmentId === cleanShipmentId && e.customerId === cleanCustomerId)
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              customerId: cleanCustomerId,
              shipmentId: cleanShipmentId,
              totalEvents: events.length,
              timeline: events
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
// REST API Routes (Capabilities 1, 2, and 3)
// ==========================================

/**
 * Health Check Endpoint
 * GET /health
 */
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'UP',
    service: 'DeliverEase Mock & MCP Server',
    version: '2.0.0',
    capabilities: [
      'CAPABILITY 1 — Trusted Recipient & Delivery Preferences',
      'CAPABILITY 2 — Delivery Mode & Autonomy Policy Engine',
      'CAPABILITY 3 — Delivery Escalation & Audit Timeline'
    ],
    mcp: {
      sseEndpoint: '/sse',
      messagesEndpoint: '/messages',
      tools: [
        'get_preferences',
        'update_preferences',
        'get_authorized_recipient',
        'get_mode_policy',
        'evaluate_delivery_action',
        'create_resolution_plan',
        'record_delivery_event',
        'get_delivery_timeline'
      ]
    },
    demoData: {
      customer: 'DEMO001',
      shipments: Object.keys(shipmentsStore),
      totalTimelineEvents: deliveryTimelineStore.length
    },
    timestamp: new Date().toISOString()
  });
});

// ------------------------------------------
// Capability 1 REST Endpoints
// ------------------------------------------

/**
 * 1. GET /api/preferences/:customerId
 */
app.get('/api/preferences/:customerId', (req, res) => {
  const { customerId } = req.params;
  if (!customerId || !customerId.trim()) {
    return res.status(400).json({ success: false, error: 'Invalid or missing customerId parameter.' });
  }

  const customer = customersStore[customerId.trim().toUpperCase()];
  if (!customer) {
    return res.status(404).json({ success: false, error: `Customer not found with ID '${customerId}'.`, customerId });
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
    return res.status(400).json({ success: false, error: 'Invalid or missing customerId parameter.' });
  }

  const existingCustomer = customersStore[key];
  if (!existingCustomer) {
    return res.status(404).json({ success: false, error: `Customer '${customerId}' does not exist.` });
  }

  const { mode, preferences, location, recipientName, recipientRelation, recipientPhone, preferredTime, authorizationStatus } = req.body || {};

  if (mode !== undefined) {
    if (typeof mode !== 'string' || !VALID_MODES.includes(mode.trim().toUpperCase())) {
      return res.status(400).json({ success: false, error: `Invalid mode "${mode}". Must be one of: ${VALID_MODES.join(', ')}.` });
    }
    existingCustomer.mode = mode.trim().toUpperCase();
  }

  if (preferences !== undefined) {
    if (!Array.isArray(preferences)) {
      return res.status(400).json({ success: false, error: 'Preferences must be an array of preference objects.' });
    }
    for (let i = 0; i < preferences.length; i++) {
      const errorMsg = validatePreferenceItem(preferences[i]);
      if (errorMsg) {
        return res.status(400).json({ success: false, error: `Validation error at preferences[${i}]: ${errorMsg}` });
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
  } else if (location !== undefined) {
    const prefError = validatePreferenceItem(req.body);
    if (prefError) return res.status(400).json({ success: false, error: prefError });

    const normLocation = location.trim();
    const existingIndex = existingCustomer.preferences.findIndex(p => p.location.toLowerCase() === normLocation.toLowerCase());
    const updatedPref = {
      location: normLocation,
      recipientName: recipientName !== undefined ? String(recipientName).trim() : (existingIndex >= 0 ? existingCustomer.preferences[existingIndex].recipientName : ''),
      recipientRelation: recipientRelation !== undefined ? String(recipientRelation).trim() : (existingIndex >= 0 ? existingCustomer.preferences[existingIndex].recipientRelation : ''),
      recipientPhone: recipientPhone !== undefined ? String(recipientPhone).trim() : (existingIndex >= 0 ? existingCustomer.preferences[existingIndex].recipientPhone : ''),
      preferredTime: preferredTime !== undefined ? String(preferredTime).trim() : (existingIndex >= 0 ? existingCustomer.preferences[existingIndex].preferredTime : ''),
      authorizationStatus: authorizationStatus !== undefined ? String(authorizationStatus).trim().toUpperCase() : (existingIndex >= 0 ? existingCustomer.preferences[existingIndex].authorizationStatus : 'AUTHORIZED')
    };

    if (existingIndex >= 0) existingCustomer.preferences[existingIndex] = updatedPref;
    else existingCustomer.preferences.push(updatedPref);
  }

  if (mode === undefined && preferences === undefined && location === undefined) {
    return res.status(400).json({ success: false, error: 'Request body must contain "mode", "preferences" array, or a preference object with "location".' });
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
    return res.status(400).json({ success: false, error: 'Missing required query parameter: "customerId" is required.' });
  }
  if (!location || !location.trim()) {
    return res.status(400).json({ success: false, error: 'Missing required query parameter: "location" is required.' });
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

  const matchedPref = customer.preferences.find(p => p.location.trim().toLowerCase() === cleanLocation.toLowerCase());
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
// Capability 2 REST Endpoints
// ------------------------------------------

/**
 * GET /api/policy/:customerId
 */
app.get('/api/policy/:customerId', (req, res) => {
  const { customerId } = req.params;
  const key = customerId ? customerId.trim().toUpperCase() : '';
  const customer = customersStore[key];
  if (!customer) {
    return res.status(404).json({ success: false, error: `Customer not found with ID '${customerId}'.` });
  }

  const policy = evaluateModePolicy(customer);
  return res.status(200).json({ success: true, policy });
});

/**
 * POST /api/policy/:customerId/evaluate
 */
app.post('/api/policy/:customerId/evaluate', (req, res) => {
  const { customerId } = req.params;
  const { situation } = req.body || {};
  const key = customerId ? customerId.trim().toUpperCase() : '';
  const customer = customersStore[key];

  if (!customer) {
    return res.status(404).json({
      success: false,
      decision: 'ESCALATE',
      error: `Customer '${customerId}' not found.`
    });
  }

  const evaluation = evaluateActionDecision(customer, situation);
  return res.status(200).json({ success: true, evaluation });
});

// ------------------------------------------
// Capability 3 REST Endpoints
// ------------------------------------------

/**
 * POST /api/resolution-plan
 */
app.post('/api/resolution-plan', (req, res) => {
  const { customerId, shipmentId, situation } = req.body || {};
  if (!customerId || !shipmentId) {
    return res.status(400).json({ success: false, error: 'Both customerId and shipmentId are required.' });
  }

  const key = customerId.trim().toUpperCase();
  const customer = customersStore[key];
  const plan = buildResolutionPlan(customerId, shipmentId, situation, customer);

  // Automatically record resolution plan creation in audit timeline
  const eventId = `EVT-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  deliveryTimelineStore.push({
    eventId,
    timestamp: new Date().toISOString(),
    customerId: key,
    shipmentId: shipmentId.trim().toUpperCase(),
    eventType: 'RESOLUTION_PLAN_CREATED',
    details: {
      situation,
      resolutionType: plan.resolutionType,
      priority: plan.priority
    }
  });

  return res.status(200).json({ success: true, plan });
});

/**
 * POST /api/timeline/events
 */
app.post('/api/timeline/events', (req, res) => {
  const { customerId, shipmentId, eventType, details } = req.body || {};
  if (!customerId || !shipmentId || !eventType) {
    return res.status(400).json({ success: false, error: 'customerId, shipmentId, and eventType are required.' });
  }

  const upperType = eventType.trim().toUpperCase();
  if (upperType === 'DELIVERY_COMPLETED' && (!details || !details.connectorConfirmation)) {
    return res.status(400).json({
      success: false,
      error: 'Safety Rule Violation: Delivery completion requires verified connector confirmation.'
    });
  }

  const eventId = `EVT-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  const newEvent = {
    eventId,
    timestamp: new Date().toISOString(),
    customerId: customerId.trim().toUpperCase(),
    shipmentId: shipmentId.trim().toUpperCase(),
    eventType: upperType,
    details: details || {}
  };

  deliveryTimelineStore.push(newEvent);
  return res.status(201).json({ success: true, event: newEvent });
});

/**
 * GET /api/timeline
 */
app.get('/api/timeline', (req, res) => {
  const { customerId, shipmentId } = req.query;
  if (!customerId || !shipmentId) {
    return res.status(400).json({ success: false, error: 'Query parameters customerId and shipmentId are required.' });
  }

  const cleanCustomerId = customerId.trim().toUpperCase();
  const cleanShipmentId = shipmentId.trim().toUpperCase();

  const events = deliveryTimelineStore
    .filter(e => e.shipmentId === cleanShipmentId && e.customerId === cleanCustomerId)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  return res.status(200).json({
    success: true,
    customerId: cleanCustomerId,
    shipmentId: cleanShipmentId,
    totalEvents: events.length,
    timeline: events
  });
});

/**
 * GET /api/shipments/:shipmentId
 */
app.get('/api/shipments/:shipmentId', (req, res) => {
  const { shipmentId } = req.params;
  const key = shipmentId ? shipmentId.trim().toUpperCase() : '';
  const shipment = shipmentsStore[key];
  if (!shipment) {
    return res.status(404).json({ success: false, error: `Shipment '${shipmentId}' not found.` });
  }
  return res.status(200).json({ success: true, shipment });
});

/**
 * Reset Demo Data Helper (Hackathon utility)
 * POST /api/reset
 */
app.post('/api/reset', (req, res) => {
  customersStore = getInitialSeedCustomers();
  shipmentsStore = getInitialSeedShipments();
  deliveryTimelineStore = getInitialSeedTimeline();

  res.status(200).json({
    success: true,
    message: 'Demo customer, shipments, and audit timeline data reset to initial state.',
    customers: Object.keys(customersStore),
    shipments: Object.keys(shipmentsStore),
    totalEvents: deliveryTimelineStore.length
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
      'GET /api/policy/:customerId',
      'POST /api/policy/:customerId/evaluate',
      'POST /api/resolution-plan',
      'POST /api/timeline/events',
      'GET /api/timeline?customerId=...&shipmentId=...',
      'GET /api/shipments/:shipmentId',
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
    console.log(`📦 Capabilities : 3 Custom Capabilities Active`);
    console.log(`   1. Trusted Recipient & Delivery Preferences`);
    console.log(`   2. Delivery Mode & Autonomy Policy Engine`);
    console.log(`   3. Delivery Escalation & Audit Timeline`);
    console.log(`🛠️  MCP Tools   : 8 Registered Tools`);
    console.log(`📋 Demo Data    : DEMO001 (Home, Hostel, Office), SHIP001, SHIP002`);
    console.log(`===================================================`);
  });
}

module.exports = app;
