/**
 * Comprehensive Automated Test Suite for DeliverEase Mock & MCP Server
 * Validates All 3 Capabilities across REST Endpoints and 9 MCP Tools over SSE
 */
const http = require('http');
const app = require('./server');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { SSEClientTransport } = require('@modelcontextprotocol/sdk/client/sse.js');

const TEST_PORT = 3299;
let server;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

let passedCount = 0;
let failedCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passedCount++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failedCount++;
  }
}

async function runTests() {
  console.log('🧪 Starting DeliverEase 3 Capabilities REST & MCP Tests...\n');

  try {
    // ==========================================
    // SECTION 1: REST API Tests (All 3 Capabilities)
    // ==========================================
    console.log('=========================================');
    console.log('📍 PART 1: REST ENDPOINTS (CAPABILITIES 1, 2, 3)');
    console.log('=========================================');

    // 1. Health check
    console.log('\n[REST Test 1] GET /health');
    const healthRes = await fetch(`${BASE_URL}/health`);
    const healthData = await healthRes.json();
    assert(healthRes.status === 200, 'Health endpoint returns 200 OK');
    assert(healthData.status === 'UP', 'Health status is UP');
    assert(healthData.capabilities.length === 3, 'All 3 capabilities listed in health check');
    assert(healthData.mcp && healthData.mcp.toolCount === 9, 'Exactly 9 MCP tools listed in health check');

    // 2. Capability 1: GET preferences for DEMO001
    console.log('\n[REST Test 2] GET /api/preferences/DEMO001');
    const prefRes = await fetch(`${BASE_URL}/api/preferences/DEMO001`);
    const prefData = await prefRes.json();
    assert(prefRes.status === 200, 'DEMO001 preferences returns 200 OK');
    assert(prefData.customerId === 'DEMO001', 'CustomerId is DEMO001');
    assert(prefData.mode === 'ACTIVE', 'Mode is ACTIVE');
    assert(prefData.preferences.length === 3, 'Contains 3 seed locations (Home, Hostel, Office)');

    // 3. Capability 1: GET recipient for Home (Authorized Mummy)
    console.log('\n[REST Test 3] GET /api/recipient?customerId=DEMO001&location=Home');
    const homeRes = await fetch(`${BASE_URL}/api/recipient?customerId=DEMO001&location=Home`);
    const homeData = await homeRes.json();
    assert(homeRes.status === 200, 'Returns 200 OK');
    assert(homeData.authorizationStatus === 'AUTHORIZED', 'Authorization status is AUTHORIZED');
    assert(homeData.recipientName.includes('Mummy'), 'Recipient name contains Mummy');
    assert(homeData.recipientPhone === '+919876543210', 'Phone number matches seed');

    // 4. Capability 1: GET recipient for unauthorized location (Gym)
    console.log('\n[REST Test 4] GET /api/recipient?customerId=DEMO001&location=Gym');
    const gymRes = await fetch(`${BASE_URL}/api/recipient?customerId=DEMO001&location=Gym`);
    const gymData = await gymRes.json();
    assert(gymRes.status === 200, 'Returns 200 OK');
    assert(gymData.authorizationStatus === 'NOT_AUTHORIZED', 'Safety rule: Unregistered location returns NOT_AUTHORIZED');
    assert(gymData.recipient === null, 'Safety rule: recipient object is null');

    // 5. Capability 2: POST /api/recovery/options
    console.log('\n[REST Test 5] POST /api/recovery/options (delivery failed)');
    const recOptRes = await fetch(`${BASE_URL}/api/recovery/options`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerId: 'DEMO001', shipmentId: 'SHIP001', situation: 'delivery failed' })
    });
    const recOptData = await recOptRes.json();
    assert(recOptRes.status === 200, 'Recovery options returns 200 OK');
    assert(recOptData.recommendedAction === 'REATTEMPT', 'Recommended action is REATTEMPT');
    assert(Array.isArray(recOptData.availableActions), 'Available actions is an array');

    // 6. Capability 2: POST /api/recovery/plan
    console.log('\n[REST Test 6] POST /api/recovery/plan (REATTEMPT)');
    const planRes = await fetch(`${BASE_URL}/api/recovery/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerId: 'DEMO001',
        shipmentId: 'SHIP001',
        situation: 'delivery attempt missed',
        requestedAction: 'REATTEMPT'
      })
    });
    const planData = await planRes.json();
    assert(planRes.status === 200, 'Plan creation returns 200 OK');
    assert(planData.success === true, 'Plan creation success is true');
    assert(planData.recoveryAction === 'REATTEMPT', 'Recovery action is REATTEMPT');
    assert(planData.requiredInformation.includes('targetReattemptDate'), 'Requires targetReattemptDate');

    // 7. Capability 2: GET /api/recovery/status/:shipmentId
    console.log('\n[REST Test 7] GET /api/recovery/status/SHIP001');
    const statusRes = await fetch(`${BASE_URL}/api/recovery/status/SHIP001`);
    const statusData = await statusRes.json();
    assert(statusRes.status === 200, 'Recovery status returns 200 OK');
    assert(statusData.status === 'PLAN_CREATED', 'Safety rule: Status is PLAN_CREATED (never claimed executed without confirmation)');

    // 8. Capability 3: POST /api/notifications (CUSTOMER)
    console.log('\n[REST Test 8] POST /api/notifications (CUSTOMER)');
    const notifRes = await fetch(`${BASE_URL}/api/notifications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerId: 'DEMO001',
        shipmentId: 'SHIP001',
        recipientType: 'CUSTOMER',
        notificationType: 'DELIVERY_UPDATE',
        message: 'Your courier is approaching in 15 minutes.'
      })
    });
    const notifData = await notifRes.json();
    assert(notifRes.status === 201, 'Notification created with 201 Created');
    assert(notifData.status === 'PENDING', 'Notification status initialized to PENDING');
    const createdNotifId = notifData.notificationId;

    // 9. Capability 3: PUT /api/notifications/:notificationId (Update to DELIVERED with connector)
    console.log('\n[REST Test 9] PUT /api/notifications/:id (Status update with connector confirmation)');
    const updateNotifRes = await fetch(`${BASE_URL}/api/notifications/${createdNotifId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'DELIVERED',
        connector: 'Twilio-SMS',
        details: 'Delivered to handset'
      })
    });
    const updateNotifData = await updateNotifRes.json();
    assert(updateNotifRes.status === 200, 'Status update returns 200 OK');
    assert(updateNotifData.status === 'DELIVERED', 'Status updated to DELIVERED');
    assert(updateNotifData.connector === 'Twilio-SMS', 'Connector confirmation recorded');

    // 10. Capability 3: GET /api/notifications/:shipmentId (History)
    console.log('\n[REST Test 10] GET /api/notifications/SHIP001');
    const histRes = await fetch(`${BASE_URL}/api/notifications/SHIP001`);
    const histData = await histRes.json();
    assert(histRes.status === 200, 'Notification history returns 200 OK');
    assert(Array.isArray(histData.history), 'History returned as array');
    assert(histData.totalNotifications >= 2, 'History contains seed + newly created notification');

    // 11. Reset test
    console.log('\n[REST Test 11] POST /api/reset');
    const resetRes = await fetch(`${BASE_URL}/api/reset`, { method: 'POST' });
    const resetData = await resetRes.json();
    assert(resetRes.status === 200, 'Reset returns 200 OK');
    assert(resetData.success === true, 'Reset success is true');

    // ==========================================
    // SECTION 2: Model Context Protocol (MCP) Tests
    // Testing All 9 Tools over SSE Transport
    // ==========================================
    console.log('\n=========================================');
    console.log('🤖 PART 2: MCP PROTOCOL & 9 TOOLS VERIFICATION');
    console.log('=========================================');

    console.log('\n[MCP Connection] Connecting to MCP Server via SSE...');
    const mcpClientTransport = new SSEClientTransport(new URL(`${BASE_URL}/sse`));
    const mcpClient = new Client({ name: 'deliverease-test-client', version: '1.0.0' }, { capabilities: {} });
    await mcpClient.connect(mcpClientTransport);
    assert(true, 'MCP Client successfully connected over SSE');

    // 12. Tool Discovery: Exactly 9 Tools
    console.log('\n[MCP Tool Discovery] Listing registered tools...');
    const toolsResponse = await mcpClient.listTools();
    const toolNames = toolsResponse.tools.map(t => t.name);
    console.log('Found MCP Tools:', toolNames);
    assert(toolNames.length === 9, 'Exactly 9 custom MCP tools registered');
    assert(toolNames.includes('get_preferences'), 'Tool 1: get_preferences');
    assert(toolNames.includes('update_preferences'), 'Tool 2: update_preferences');
    assert(toolNames.includes('get_authorized_recipient'), 'Tool 3: get_authorized_recipient');
    assert(toolNames.includes('get_recovery_options'), 'Tool 4: get_recovery_options');
    assert(toolNames.includes('create_recovery_plan'), 'Tool 5: create_recovery_plan');
    assert(toolNames.includes('get_recovery_status'), 'Tool 6: get_recovery_status');
    assert(toolNames.includes('create_notification'), 'Tool 7: create_notification');
    assert(toolNames.includes('update_notification_status'), 'Tool 8: update_notification_status');
    assert(toolNames.includes('get_notification_history'), 'Tool 9: get_notification_history');

    // 13. Capability 1: get_preferences
    console.log('\n[MCP Tool 1] get_preferences("DEMO001")...');
    const cap1Pref = await mcpClient.callTool({ name: 'get_preferences', arguments: { customerId: 'DEMO001' } });
    const parsedCap1Pref = JSON.parse(cap1Pref.content[0].text);
    assert(parsedCap1Pref.customerId === 'DEMO001', 'CustomerId is DEMO001');
    assert(parsedCap1Pref.mode === 'ACTIVE', 'Initial mode is ACTIVE');
    assert(parsedCap1Pref.preferences.length === 3, 'Contains 3 seed locations');

    // 14. Capability 1: get_authorized_recipient (Home, Hostel, Office)
    console.log('\n[MCP Tool 3] get_authorized_recipient for Home, Hostel, Office...');
    const homeToolRes = await mcpClient.callTool({ name: 'get_authorized_recipient', arguments: { customerId: 'DEMO001', location: 'Home' } });
    const parsedHome = JSON.parse(homeToolRes.content[0].text);
    assert(parsedHome.authorizationStatus === 'AUTHORIZED', 'Home is AUTHORIZED');
    assert(parsedHome.recipientName.includes('Mummy'), 'Mummy is authorized recipient');

    const hostelToolRes = await mcpClient.callTool({ name: 'get_authorized_recipient', arguments: { customerId: 'DEMO001', location: 'Hostel' } });
    const parsedHostel = JSON.parse(hostelToolRes.content[0].text);
    assert(parsedHostel.authorizationStatus === 'AUTHORIZED', 'Hostel is AUTHORIZED (Self)');

    const officeToolRes = await mcpClient.callTool({ name: 'get_authorized_recipient', arguments: { customerId: 'DEMO001', location: 'Office' } });
    const parsedOffice = JSON.parse(officeToolRes.content[0].text);
    assert(parsedOffice.authorizationStatus === 'AUTHORIZED', 'Office is AUTHORIZED (Security Desk)');

    // 15. Capability 1: Unauthorized location safety test
    console.log('\n[MCP Tool 3] Safety check: get_authorized_recipient for unregistered location (Gym)...');
    const gymToolRes = await mcpClient.callTool({ name: 'get_authorized_recipient', arguments: { customerId: 'DEMO001', location: 'Gym' } });
    const parsedGym = JSON.parse(gymToolRes.content[0].text);
    assert(parsedGym.authorizationStatus === 'NOT_AUTHORIZED', 'Safety rule: Unregistered location returns NOT_AUTHORIZED');
    assert(parsedGym.recipient === null, 'Safety rule: recipient object is null');

    // 16. Capability 2: get_recovery_options in ACTIVE mode (delivery failure, NDR, reschedule)
    console.log('\n[MCP Tool 4] get_recovery_options for delivery failed in ACTIVE mode...');
    const recOptFail = await mcpClient.callTool({
      name: 'get_recovery_options',
      arguments: { customerId: 'DEMO001', shipmentId: 'SHIP002', situation: 'delivery failed' }
    });
    const parsedRecFail = JSON.parse(recOptFail.content[0].text);
    assert(parsedRecFail.recommendedAction === 'REATTEMPT', 'ACTIVE mode delivery failed -> REATTEMPT');

    console.log('\n[MCP Tool 4] get_recovery_options for NDR...');
    const recOptNdr = await mcpClient.callTool({
      name: 'get_recovery_options',
      arguments: { customerId: 'DEMO001', shipmentId: 'SHIP002', situation: 'NDR / non-delivery report' }
    });
    const parsedRecNdr = JSON.parse(recOptNdr.content[0].text);
    assert(parsedRecNdr.recommendedAction === 'REATTEMPT', 'NDR -> REATTEMPT');

    console.log('\n[MCP Tool 4] get_recovery_options for customer asks for rescheduling...');
    const recOptResched = await mcpClient.callTool({
      name: 'get_recovery_options',
      arguments: { customerId: 'DEMO001', shipmentId: 'SHIP002', situation: 'customer asks for rescheduling' }
    });
    const parsedRecResched = JSON.parse(recOptResched.content[0].text);
    assert(parsedRecResched.recommendedAction === 'RESCHEDULE', 'Rescheduling situation -> RESCHEDULE');

    console.log('\n[MCP Tool 4] Safety check: Missing required delivery information...');
    const recOptMissing = await mcpClient.callTool({
      name: 'get_recovery_options',
      arguments: { customerId: 'DEMO001', shipmentId: 'SHIP002', situation: 'required delivery information missing' }
    });
    const parsedRecMissing = JSON.parse(recOptMissing.content[0].text);
    assert(parsedRecMissing.recommendedAction === 'ESCALATE', 'Safety rule: Missing info -> ESCALATE');
    assert(parsedRecMissing.escalationRequired === true, 'Escalation required is true');

    console.log('\n[MCP Tool 4] Recovery escalation: courier refuses handoff...');
    const recOptRefuse = await mcpClient.callTool({
      name: 'get_recovery_options',
      arguments: { customerId: 'DEMO001', shipmentId: 'SHIP002', situation: 'courier refuses handoff' }
    });
    const parsedRecRefuse = JSON.parse(recOptRefuse.content[0].text);
    assert(parsedRecRefuse.recommendedAction === 'ESCALATE', 'Courier refusal -> ESCALATE');
    assert(parsedRecRefuse.escalationRequired === true, 'Escalation required for courier refusal');

    // 17. Capability 2: ASSIST Mode Evaluation
    console.log('\n[Shared State & Mode Test] Switching mode to ASSIST...');
    await mcpClient.callTool({ name: 'update_preferences', arguments: { customerId: 'DEMO001', mode: 'ASSIST' } });

    const recOptAssistUnavail = await mcpClient.callTool({
      name: 'get_recovery_options',
      arguments: { customerId: 'DEMO001', shipmentId: 'SHIP002', situation: 'customer unavailable' }
    });
    const parsedAssistUnavail = JSON.parse(recOptAssistUnavail.content[0].text);
    assert(parsedAssistUnavail.recommendedAction === 'CONTACT_RECIPIENT', 'ASSIST mode customer unavailable -> CONTACT_RECIPIENT');

    const recOptAssistNormal = await mcpClient.callTool({
      name: 'get_recovery_options',
      arguments: { customerId: 'DEMO001', shipmentId: 'SHIP002', situation: 'courier cannot access location' }
    });
    const parsedAssistNormal = JSON.parse(recOptAssistNormal.content[0].text);
    assert(parsedAssistNormal.recommendedAction === 'CONTACT_CUSTOMER', 'ASSIST mode normal issue -> CONTACT_CUSTOMER first');

    // 18. Capability 2 & 1: OFF Mode Evaluation
    console.log('\n[Shared State & Mode Test] Switching mode to OFF...');
    await mcpClient.callTool({ name: 'update_preferences', arguments: { customerId: 'DEMO001', mode: 'OFF' } });

    // Mode OFF blocks recipient lookup
    const offRecipientRes = await mcpClient.callTool({ name: 'get_authorized_recipient', arguments: { customerId: 'DEMO001', location: 'Home' } });
    const parsedOffRec = JSON.parse(offRecipientRes.content[0].text);
    assert(parsedOffRec.authorizationStatus === 'NOT_AUTHORIZED', 'Safety check: Mode OFF blocks recipient authorization');

    // Mode OFF blocks autonomous proxy handoff in recovery plan
    const offPlanRes = await mcpClient.callTool({
      name: 'create_recovery_plan',
      arguments: {
        customerId: 'DEMO001',
        shipmentId: 'SHIP002',
        situation: 'customer unavailable',
        requestedAction: 'CONTACT_RECIPIENT'
      }
    });
    const parsedOffPlan = JSON.parse(offPlanRes.content[0].text);
    assert(parsedOffPlan.recoveryAction === 'ESCALATE', 'Safety check: Mode OFF forbids CONTACT_RECIPIENT and escalates');
    assert(parsedOffPlan.escalationRequired === true, 'Escalation required is true');

    // 19. Capability 2: create_recovery_plan & get_recovery_status
    console.log('\n[MCP Tool 5 & 6] Restore mode to ACTIVE and create recovery plan...');
    await mcpClient.callTool({ name: 'update_preferences', arguments: { customerId: 'DEMO001', mode: 'ACTIVE' } });

    const createPlanRes = await mcpClient.callTool({
      name: 'create_recovery_plan',
      arguments: {
        customerId: 'DEMO001',
        shipmentId: 'SHIP002',
        situation: 'delivery attempt missed',
        requestedAction: 'REATTEMPT'
      }
    });
    const parsedCreatePlan = JSON.parse(createPlanRes.content[0].text);
    assert(parsedCreatePlan.success === true, 'create_recovery_plan returns success: true');
    assert(parsedCreatePlan.recoveryAction === 'REATTEMPT', 'Recovery action is REATTEMPT');

    const getPlanStatus = await mcpClient.callTool({
      name: 'get_recovery_status',
      arguments: { customerId: 'DEMO001', shipmentId: 'SHIP002' }
    });
    const parsedPlanStatus = JSON.parse(getPlanStatus.content[0].text);
    assert(parsedPlanStatus.success === true, 'get_recovery_status returns success: true');
    assert(parsedPlanStatus.status === 'PLAN_CREATED', 'Status is PLAN_CREATED');
    assert(parsedPlanStatus.recoveryAction === 'REATTEMPT', 'Plan recoveryAction matches');

    // 20. Capability 3: create_notification (CUSTOMER)
    console.log('\n[MCP Tool 7] create_notification for CUSTOMER...');
    const notifCustRes = await mcpClient.callTool({
      name: 'create_notification',
      arguments: {
        customerId: 'DEMO001',
        shipmentId: 'SHIP002',
        recipientType: 'CUSTOMER',
        notificationType: 'REATTEMPT_SCHEDULED',
        message: 'Your delivery has been rescheduled for tomorrow 10:00 AM.'
      }
    });
    const parsedNotifCust = JSON.parse(notifCustRes.content[0].text);
    assert(parsedNotifCust.status === 'PENDING', 'Notification status initialized to PENDING');
    assert(parsedNotifCust.recipientType === 'CUSTOMER', 'Recipient type is CUSTOMER');
    const mcpNotifId = parsedNotifCust.notificationId;

    // 21. Capability 3: create_notification (AUTHORIZED_RECIPIENT)
    console.log('\n[MCP Tool 7] create_notification for AUTHORIZED_RECIPIENT...');
    const notifAuthRes = await mcpClient.callTool({
      name: 'create_notification',
      arguments: {
        customerId: 'DEMO001',
        shipmentId: 'SHIP002',
        recipientType: 'AUTHORIZED_RECIPIENT',
        notificationType: 'RECIPIENT_ALERT',
        message: 'Please receive Aarav parcel SHIP002 at Home between 10:00 AM - 01:00 PM.'
      }
    });
    const parsedNotifAuth = JSON.parse(notifAuthRes.content[0].text);
    assert(parsedNotifAuth.status === 'PENDING', 'Authorized recipient notification status is PENDING');
    assert(parsedNotifAuth.recipientType === 'AUTHORIZED_RECIPIENT', 'Recipient type is AUTHORIZED_RECIPIENT');

    // 22. Capability 3: update_notification_status (Safety check: connector required)
    console.log('\n[MCP Tool 8] Safety check: Cannot mark DELIVERED without connector confirmation...');
    const unconfirmedUpdate = await mcpClient.callTool({
      name: 'update_notification_status',
      arguments: {
        notificationId: mcpNotifId,
        status: 'DELIVERED',
        connector: ''
      }
    });
    assert(unconfirmedUpdate.isError === true, 'Safety rule: Tool errors when connector is missing for DELIVERED status');

    console.log('\n[MCP Tool 8] Successful notification transition: PENDING -> SENT -> DELIVERED...');
    const sentUpdate = await mcpClient.callTool({
      name: 'update_notification_status',
      arguments: {
        notificationId: mcpNotifId,
        status: 'SENT',
        connector: 'WhatsApp-Gateway',
        details: 'Dispatched via WhatsApp Business API'
      }
    });
    const parsedSent = JSON.parse(sentUpdate.content[0].text);
    assert(parsedSent.status === 'SENT', 'Status updated to SENT');
    assert(parsedSent.connector === 'WhatsApp-Gateway', 'Connector recorded as WhatsApp-Gateway');

    const deliveredUpdate = await mcpClient.callTool({
      name: 'update_notification_status',
      arguments: {
        notificationId: mcpNotifId,
        status: 'DELIVERED',
        connector: 'WhatsApp-Gateway',
        details: 'Read receipt confirmed by recipient'
      }
    });
    const parsedDelivered = JSON.parse(deliveredUpdate.content[0].text);
    assert(parsedDelivered.status === 'DELIVERED', 'Status updated to DELIVERED');

    // 23. Capability 3: get_notification_history
    console.log('\n[MCP Tool 9] get_notification_history for SHIP002...');
    const historyRes = await mcpClient.callTool({
      name: 'get_notification_history',
      arguments: { customerId: 'DEMO001', shipmentId: 'SHIP002' }
    });
    const parsedHistory = JSON.parse(historyRes.content[0].text);
    assert(parsedHistory.success === true, 'get_notification_history success is true');
    assert(parsedHistory.totalNotifications >= 2, 'Contains at least 2 notifications for SHIP002');
    assert(parsedHistory.history[0].notificationId !== undefined, 'Chronological history items contain notificationId');

    // 24. Shared State Cross-Verification: REST endpoint sees MCP changes
    console.log('\n[Shared State Test] Checking REST endpoint for MCP created plan & notification...');
    const restPlanCheck = await fetch(`${BASE_URL}/api/recovery/status/SHIP002`);
    const restPlanData = await restPlanCheck.json();
    assert(restPlanData.success === true, 'Shared State: REST endpoint sees recovery plan created via MCP');
    assert(restPlanData.recoveryAction === 'REATTEMPT', 'Shared State: Recovery action matches');

    const restNotifCheck = await fetch(`${BASE_URL}/api/notifications/SHIP002?customerId=DEMO001`);
    const restNotifData = await restNotifCheck.json();
    assert(restNotifData.totalNotifications === parsedHistory.totalNotifications, 'Shared State: REST notification history matches MCP history');

    // Close client cleanly
    await mcpClient.close();
    assert(true, 'MCP Client closed cleanly');

  } catch (err) {
    console.error('Test execution error:', err);
    failedCount++;
  } finally {
    server.close(() => {
      console.log('\n=========================================');
      console.log(`🏁 Complete Test Suite: ${passedCount} Passed, ${failedCount} Failed`);
      console.log('=========================================');
      process.exit(failedCount > 0 ? 1 : 0);
    });
  }
}

server = app.listen(TEST_PORT, () => {
  runTests();
});
