/**
 * Comprehensive Test Suite for DeliverEase 3 Custom Capabilities
 * Tests both REST Endpoints and Model Context Protocol (MCP) Tools over SSE
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
  console.log('🧪 Starting DeliverEase 3 Custom Capabilities REST & MCP Tests...\n');

  try {
    // ==========================================
    // SECTION 1: REST API Tests
    // ==========================================
    console.log('=========================================');
    console.log('📍 PART 1: REST ENDPOINTS (Capabilities 1, 2, 3)');
    console.log('=========================================');

    // 1. Health check
    console.log('\n[Test 1] GET /health');
    const healthRes = await fetch(`${BASE_URL}/health`);
    const healthData = await healthRes.json();
    assert(healthRes.status === 200, 'Health endpoint returns 200 OK');
    assert(healthData.status === 'UP', 'Health status is UP');
    assert(healthData.capabilities.length === 3, 'All 3 DeliverEase capabilities listed');
    assert(healthData.mcp && healthData.mcp.tools.length === 8, 'All 8 MCP tools advertised in health check');

    // 2. Capability 1 REST: Preferences
    console.log('\n[Test 2] GET /api/preferences/DEMO001');
    const prefRes = await fetch(`${BASE_URL}/api/preferences/DEMO001`);
    const prefData = await prefRes.json();
    assert(prefRes.status === 200, 'Preferences endpoint returns 200 OK');
    assert(prefData.customerId === 'DEMO001', 'CustomerId is DEMO001');
    assert(prefData.mode === 'ACTIVE', 'Initial mode is ACTIVE');
    assert(prefData.preferences.length === 3, 'Contains 3 locations: Home, Hostel, Office');

    // 3. Capability 1 REST: Recipient resolution
    console.log('\n[Test 3] GET /api/recipient queries');
    const homeRes = await fetch(`${BASE_URL}/api/recipient?customerId=DEMO001&location=Home`);
    const homeData = await homeRes.json();
    assert(homeData.authorizationStatus === 'AUTHORIZED', 'Home recipient authorized (Mummy)');

    const hostelRes = await fetch(`${BASE_URL}/api/recipient?customerId=DEMO001&location=Hostel`);
    const hostelData = await hostelRes.json();
    assert(hostelData.authorizationStatus === 'AUTHORIZED', 'Hostel recipient authorized (Self)');

    const officeRes = await fetch(`${BASE_URL}/api/recipient?customerId=DEMO001&location=Office`);
    const officeData = await officeRes.json();
    assert(officeData.authorizationStatus === 'AUTHORIZED', 'Office recipient authorized (Security Desk)');

    const gymRes = await fetch(`${BASE_URL}/api/recipient?customerId=DEMO001&location=Gym`);
    const gymData = await gymRes.json();
    assert(gymData.authorizationStatus === 'NOT_AUTHORIZED', 'Safety rule: Unregistered location returns NOT_AUTHORIZED');

    // 4. Capability 2 REST: Policy check
    console.log('\n[Test 4] GET /api/policy/DEMO001');
    const policyRes = await fetch(`${BASE_URL}/api/policy/DEMO001`);
    const policyData = await policyRes.json();
    assert(policyRes.status === 200, 'Policy endpoint returns 200 OK');
    assert(policyData.policy.currentMode === 'ACTIVE', 'Current mode is ACTIVE');
    assert(policyData.policy.autonomousActionsAllowed === true, 'Autonomous actions allowed in ACTIVE mode');
    assert(policyData.policy.proxyHandoffAllowed === true, 'Proxy handoff allowed in ACTIVE mode');

    // 5. Capability 2 REST: Evaluate Action
    console.log('\n[Test 5] POST /api/policy/DEMO001/evaluate');
    const evalRes = await fetch(`${BASE_URL}/api/policy/DEMO001/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ situation: 'customer_unavailable' })
    });
    const evalData = await evalRes.json();
    assert(evalRes.status === 200, 'Evaluate action returns 200 OK');
    assert(evalData.evaluation.decision === 'ALLOW', 'Customer unavailable under ACTIVE mode results in ALLOW');

    // 6. Capability 3 REST: Resolution Plan
    console.log('\n[Test 6] POST /api/resolution-plan');
    const planRes = await fetch(`${BASE_URL}/api/resolution-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerId: 'DEMO001',
        shipmentId: 'SHIP001',
        situation: 'courier_cannot_access_location'
      })
    });
    const planData = await planRes.json();
    assert(planRes.status === 200, 'Resolution plan endpoint returns 200 OK');
    assert(planData.plan.resolutionType === 'GATE_ACCESS_COORDINATION', 'Resolution type is GATE_ACCESS_COORDINATION');
    assert(planData.plan.escalationRequired === true, 'Access issues require escalation');

    // 7. Capability 3 REST: Timeline & Audit Event
    console.log('\n[Test 7] Timeline endpoints');
    const timelineRes = await fetch(`${BASE_URL}/api/timeline?customerId=DEMO001&shipmentId=SHIP001`);
    const timelineData = await timelineRes.json();
    assert(timelineRes.status === 200, 'Timeline retrieved successfully');
    assert(timelineData.totalEvents >= 3, 'Pre-seeded timeline has events for SHIP001');

    // Record an event via REST
    const recordRes = await fetch(`${BASE_URL}/api/timeline/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerId: 'DEMO001',
        shipmentId: 'SHIP001',
        eventType: 'COURIER_CALL_ATTEMPTED',
        details: { courierPhone: '+919876500000', status: 'RINGING' }
      })
    });
    assert(recordRes.status === 201, 'New audit event created with 201 Created');

    // Safety rule check: cannot claim completion without connector confirmation
    const invalidCompleteRes = await fetch(`${BASE_URL}/api/timeline/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerId: 'DEMO001',
        shipmentId: 'SHIP001',
        eventType: 'DELIVERY_COMPLETED',
        details: { note: 'Claimed by voice agent without connector confirmation' }
      })
    });
    assert(invalidCompleteRes.status === 400, 'Safety Rule: Rejects delivery completion claim without connector confirmation');

    // ==========================================
    // SECTION 2: Model Context Protocol (MCP) Tests
    // ==========================================
    console.log('\n=========================================');
    console.log('🤖 PART 2: MCP PROTOCOL & TOOLS VERIFICATION');
    console.log('=========================================');

    console.log('\n[MCP Connection] Connecting client to /sse...');
    const mcpClientTransport = new SSEClientTransport(new URL(`${BASE_URL}/sse`));
    const mcpClient = new Client({ name: 'deliverease-test-suite', version: '2.0.0' }, { capabilities: {} });
    await mcpClient.connect(mcpClientTransport);
    assert(true, 'MCP Client successfully connected over SSE');

    // 8. Tool Discovery
    console.log('\n[MCP Tool Discovery] Listing registered tools...');
    const toolsResponse = await mcpClient.listTools();
    const toolNames = toolsResponse.tools.map(t => t.name);

    assert(toolNames.includes('get_preferences'), 'Cap 1 Tool: get_preferences is registered');
    assert(toolNames.includes('update_preferences'), 'Cap 1 Tool: update_preferences is registered');
    assert(toolNames.includes('get_authorized_recipient'), 'Cap 1 Tool: get_authorized_recipient is registered');
    assert(toolNames.includes('get_mode_policy'), 'Cap 2 Tool: get_mode_policy is registered');
    assert(toolNames.includes('evaluate_delivery_action'), 'Cap 2 Tool: evaluate_delivery_action is registered');
    assert(toolNames.includes('create_resolution_plan'), 'Cap 3 Tool: create_resolution_plan is registered');
    assert(toolNames.includes('record_delivery_event'), 'Cap 3 Tool: record_delivery_event is registered');
    assert(toolNames.includes('get_delivery_timeline'), 'Cap 3 Tool: get_delivery_timeline is registered');
    assert(toolNames.length === 8, 'Exact 8 MCP tools registered');

    // ------------------------------------------
    // CAPABILITY 1 MCP TESTS
    // ------------------------------------------
    console.log('\n[MCP Cap 1 Test] get_preferences("DEMO001")...');
    const cap1Pref = await mcpClient.callTool({ name: 'get_preferences', arguments: { customerId: 'DEMO001' } });
    const parsedCap1Pref = JSON.parse(cap1Pref.content[0].text);
    assert(parsedCap1Pref.customerId === 'DEMO001', 'get_preferences returns customerId');
    assert(parsedCap1Pref.preferences.length === 3, 'get_preferences returns 3 preferences');

    console.log('\n[MCP Cap 1 Test] get_authorized_recipient("DEMO001", "Home")...');
    const cap1Rec = await mcpClient.callTool({ name: 'get_authorized_recipient', arguments: { customerId: 'DEMO001', location: 'Home' } });
    const parsedCap1Rec = JSON.parse(cap1Rec.content[0].text);
    assert(parsedCap1Rec.authorizationStatus === 'AUTHORIZED', 'Home recipient is AUTHORIZED');
    assert(parsedCap1Rec.recipientName.includes('Mummy'), 'Mummy is verified recipient');

    // ------------------------------------------
    // CAPABILITY 2 MCP TESTS
    // ------------------------------------------
    console.log('\n[MCP Cap 2 Test] get_mode_policy under ACTIVE mode...');
    const activePolicyRes = await mcpClient.callTool({ name: 'get_mode_policy', arguments: { customerId: 'DEMO001' } });
    const activePolicy = JSON.parse(activePolicyRes.content[0].text);
    assert(activePolicy.currentMode === 'ACTIVE', 'Mode is ACTIVE');
    assert(activePolicy.autonomousActionsAllowed === true, 'Autonomous actions allowed');
    assert(activePolicy.proxyHandoffAllowed === true, 'Proxy handoff allowed');

    console.log('\n[MCP Cap 2 Test] evaluate_delivery_action under ACTIVE mode...');
    const evalActive1 = await mcpClient.callTool({
      name: 'evaluate_delivery_action',
      arguments: { customerId: 'DEMO001', situation: 'customer_unavailable' }
    });
    const parsedActive1 = JSON.parse(evalActive1.content[0].text);
    assert(parsedActive1.decision === 'ALLOW', 'ACTIVE mode customer_unavailable -> ALLOW');

    const evalActive2 = await mcpClient.callTool({
      name: 'evaluate_delivery_action',
      arguments: { customerId: 'DEMO001', situation: 'recipient_unavailable' }
    });
    const parsedActive2 = JSON.parse(evalActive2.content[0].text);
    assert(parsedActive2.decision === 'ESCALATE', 'recipient_unavailable -> ESCALATE');

    const evalActive3 = await mcpClient.callTool({
      name: 'evaluate_delivery_action',
      arguments: { customerId: 'DEMO001', situation: 'delivery_failed' }
    });
    const parsedActive3 = JSON.parse(evalActive3.content[0].text);
    assert(parsedActive3.decision === 'ESCALATE', 'delivery_failed -> ESCALATE');

    // Test ASSIST mode
    console.log('\n[MCP Cap 2 Test] Switching mode to ASSIST and evaluating policy...');
    await mcpClient.callTool({ name: 'update_preferences', arguments: { customerId: 'DEMO001', mode: 'ASSIST' } });

    const assistPolicyRes = await mcpClient.callTool({ name: 'get_mode_policy', arguments: { customerId: 'DEMO001' } });
    const assistPolicy = JSON.parse(assistPolicyRes.content[0].text);
    assert(assistPolicy.currentMode === 'ASSIST', 'Mode is updated to ASSIST');
    assert(assistPolicy.autonomousActionsAllowed === false, 'Autonomous actions blocked in ASSIST mode');
    assert(assistPolicy.interventionTrigger.includes('CUSTOMER_UNAVAILABLE'), 'Intervention trigger set');

    const evalAssist = await mcpClient.callTool({
      name: 'evaluate_delivery_action',
      arguments: { customerId: 'DEMO001', situation: 'customer_unavailable' }
    });
    const parsedAssist = JSON.parse(evalAssist.content[0].text);
    assert(parsedAssist.decision === 'ALLOW_WITH_ASSIST', 'ASSIST mode customer_unavailable -> ALLOW_WITH_ASSIST');

    // Test OFF mode
    console.log('\n[MCP Cap 2 Test] Switching mode to OFF and evaluating policy...');
    await mcpClient.callTool({ name: 'update_preferences', arguments: { customerId: 'DEMO001', mode: 'OFF' } });

    const offPolicyRes = await mcpClient.callTool({ name: 'get_mode_policy', arguments: { customerId: 'DEMO001' } });
    const offPolicy = JSON.parse(offPolicyRes.content[0].text);
    assert(offPolicy.currentMode === 'OFF', 'Mode is updated to OFF');
    assert(offPolicy.autonomousActionsAllowed === false, 'Autonomous actions blocked in OFF mode');
    assert(offPolicy.proxyHandoffAllowed === false, 'Proxy handoff blocked in OFF mode');

    const evalOff = await mcpClient.callTool({
      name: 'evaluate_delivery_action',
      arguments: { customerId: 'DEMO001', situation: 'customer_unavailable' }
    });
    const parsedOff = JSON.parse(evalOff.content[0].text);
    assert(parsedOff.decision === 'DENY', 'OFF mode customer_unavailable -> DENY proxy handoff');

    // Safety check: Missing/Ambiguous situation produces ESCALATE
    console.log('\n[MCP Cap 2 Test] Missing/Ambiguous situation evaluation...');
    const evalAmbiguous = await mcpClient.callTool({
      name: 'evaluate_delivery_action',
      arguments: { customerId: 'DEMO001', situation: 'some_weird_unrecognized_situation' }
    });
    const parsedAmbiguous = JSON.parse(evalAmbiguous.content[0].text);
    assert(parsedAmbiguous.decision === 'ESCALATE', 'Safety rule: Ambiguous situation produces ESCALATE');

    // ------------------------------------------
    // CAPABILITY 3 MCP TESTS
    // ------------------------------------------
    console.log('\n[MCP Cap 3 Test] create_resolution_plan...');
    // Restore mode to ACTIVE for plan testing
    await mcpClient.callTool({ name: 'update_preferences', arguments: { customerId: 'DEMO001', mode: 'ACTIVE' } });

    const plan1 = await mcpClient.callTool({
      name: 'create_resolution_plan',
      arguments: {
        customerId: 'DEMO001',
        shipmentId: 'SHIP001',
        situation: 'authorized recipient unavailable'
      }
    });
    const parsedPlan1 = JSON.parse(plan1.content[0].text);
    assert(parsedPlan1.resolutionType === 'REATTEMPT_WITH_SECONDARY_CONTACT', 'Resolution type matches recipient unavailable');
    assert(parsedPlan1.escalationRequired === true, 'Escalation required when recipient unavailable');
    assert(Array.isArray(parsedPlan1.requiredInformation), 'Lists required information');

    const planCourierRefuse = await mcpClient.callTool({
      name: 'create_resolution_plan',
      arguments: {
        customerId: 'DEMO001',
        shipmentId: 'SHIP001',
        situation: 'courier refuses handoff'
      }
    });
    const parsedPlanRefuse = JSON.parse(planCourierRefuse.content[0].text);
    assert(parsedPlanRefuse.resolutionType === 'OTP_OR_ID_VERIFICATION_SUPPORT', 'Courier refusal generates verification plan');
    assert(parsedPlanRefuse.priority === 'CRITICAL', 'Courier refusal priority is CRITICAL');

    console.log('\n[MCP Cap 3 Test] record_delivery_event...');
    const recordMcpRes = await mcpClient.callTool({
      name: 'record_delivery_event',
      arguments: {
        customerId: 'DEMO001',
        shipmentId: 'SHIP001',
        eventType: 'COORDINATION_NOTE_ADDED',
        details: { note: 'Voice agent coordinated with Hostel gate security desk.' }
      }
    });
    const parsedRecordMcp = JSON.parse(recordMcpRes.content[0].text);
    assert(parsedRecordMcp.success === true, 'MCP event recorded successfully');
    assert(parsedRecordMcp.event.eventType === 'COORDINATION_NOTE_ADDED', 'Event type matches');

    // Safety rule test: cannot record DELIVERY_COMPLETED without connector confirmation
    const safetyViolationRes = await mcpClient.callTool({
      name: 'record_delivery_event',
      arguments: {
        customerId: 'DEMO001',
        shipmentId: 'SHIP001',
        eventType: 'DELIVERY_COMPLETED',
        details: { fakeStatus: 'Delivered' }
      }
    });
    assert(safetyViolationRes.isError === true, 'Safety Rule: Tool errors when marking delivery complete without connector confirmation');

    console.log('\n[MCP Cap 3 Test] get_delivery_timeline...');
    const timelineMcpRes = await mcpClient.callTool({
      name: 'get_delivery_timeline',
      arguments: { customerId: 'DEMO001', shipmentId: 'SHIP001' }
    });
    const parsedTimelineMcp = JSON.parse(timelineMcpRes.content[0].text);
    assert(parsedTimelineMcp.success === true, 'Timeline query succeeds');
    assert(parsedTimelineMcp.shipmentId === 'SHIP001', 'ShipmentId matches');
    assert(parsedTimelineMcp.totalEvents >= 4, 'Timeline includes initial events plus newly recorded ones');

    // Shared State Test: REST endpoint sees new events recorded via MCP
    console.log('\n[Shared State Test] Checking REST timeline for MCP recorded events...');
    const restTimeline = await fetch(`${BASE_URL}/api/timeline?customerId=DEMO001&shipmentId=SHIP001`);
    const restTimelineData = await restTimeline.json();
    assert(restTimelineData.totalEvents === parsedTimelineMcp.totalEvents, 'Shared State: REST timeline matches MCP timeline exactly');

    // Reset Test
    console.log('\n[Reset Test] POST /api/reset...');
    const resetRes = await fetch(`${BASE_URL}/api/reset`, { method: 'POST' });
    const resetData = await resetRes.json();
    assert(resetData.success === true, 'Reset succeeds');
    assert(resetData.customers.includes('DEMO001'), 'DEMO001 is restored');
    assert(resetData.shipments.includes('SHIP001'), 'SHIP001 is restored');

    await mcpClient.close();
    assert(true, 'MCP Client closed cleanly');

  } catch (err) {
    console.error('Test execution error:', err);
    failedCount++;
  } finally {
    server.close(() => {
      console.log('\n=========================================');
      console.log(`🏁 All 3 Capabilities Tests Complete: ${passedCount} Passed, ${failedCount} Failed`);
      console.log('=========================================');
      process.exit(failedCount > 0 ? 1 : 0);
    });
  }
}

server = app.listen(TEST_PORT, () => {
  runTests();
});
