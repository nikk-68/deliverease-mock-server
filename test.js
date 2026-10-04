/**
 * Comprehensive Test Suite for DeliverEase Capability 1 Mock & MCP Server
 * Tests both REST Endpoints and Model Context Protocol (MCP) Tools over SSE
 */
const http = require('http');
const app = require('./server');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { SSEClientTransport } = require('@modelcontextprotocol/sdk/client/sse.js');

const TEST_PORT = 3199;
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
  console.log('🧪 Starting DeliverEase Capability 1 REST & MCP Tests...\n');

  try {
    // ==========================================
    // SECTION 1: REST API Tests
    // ==========================================
    console.log('=========================================');
    console.log('📍 PART 1: REST ENDPOINTS VERIFICATION');
    console.log('=========================================');

    // 1. Health check
    console.log('\n[Test 1] GET /health');
    const healthRes = await fetch(`${BASE_URL}/health`);
    const healthData = await healthRes.json();
    assert(healthRes.status === 200, 'Health endpoint returns 200 OK');
    assert(healthData.status === 'UP', 'Health status is UP');
    assert(Array.isArray(healthData.capabilities), 'Capabilities list returned');
    assert(healthData.mcp && healthData.mcp.sseEndpoint === '/sse', 'MCP SSE endpoint advertised in health check');

    // 2. GET preferences for DEMO001
    console.log('\n[Test 2] GET /api/preferences/DEMO001');
    const prefRes = await fetch(`${BASE_URL}/api/preferences/DEMO001`);
    const prefData = await prefRes.json();
    assert(prefRes.status === 200, 'DEMO001 preferences returns 200 OK');
    assert(prefData.customerId === 'DEMO001', 'CustomerId is DEMO001');
    assert(prefData.mode === 'ACTIVE', 'Mode is ACTIVE');
    assert(prefData.preferences.length === 3, 'Contains 3 seed locations (Home, Hostel, Office)');

    // 3. GET preferences for non-existent customer
    console.log('\n[Test 3] GET /api/preferences/UNKNOWN999');
    const notFoundRes = await fetch(`${BASE_URL}/api/preferences/UNKNOWN999`);
    const notFoundData = await notFoundRes.json();
    assert(notFoundRes.status === 404, 'Returns 404 for unknown customer');
    assert(notFoundData.success === false, 'success is false');

    // 4. GET recipient for Home (Authorized Mummy)
    console.log('\n[Test 4] GET /api/recipient?customerId=DEMO001&location=Home');
    const homeRes = await fetch(`${BASE_URL}/api/recipient?customerId=DEMO001&location=Home`);
    const homeData = await homeRes.json();
    assert(homeRes.status === 200, 'Returns 200 OK');
    assert(homeData.authorizationStatus === 'AUTHORIZED', 'Authorization status is AUTHORIZED');
    assert(homeData.recipientName.includes('Mummy'), 'Recipient name contains Mummy');
    assert(homeData.recipientRelation === 'Mother', 'Relation is Mother');
    assert(homeData.recipientPhone === '+919876543210', 'Phone number matches seed');

    // 5. GET recipient for Hostel (Authorized Self)
    console.log('\n[Test 5] GET /api/recipient?customerId=DEMO001&location=Hostel');
    const hostelRes = await fetch(`${BASE_URL}/api/recipient?customerId=DEMO001&location=Hostel`);
    const hostelData = await hostelRes.json();
    assert(hostelRes.status === 200, 'Returns 200 OK');
    assert(hostelData.authorizationStatus === 'AUTHORIZED', 'Authorization status is AUTHORIZED');
    assert(hostelData.recipientRelation === 'Self', 'Relation is Self');

    // 6. GET recipient for Office (Authorized Security Desk)
    console.log('\n[Test 6] GET /api/recipient?customerId=DEMO001&location=Office');
    const officeRes = await fetch(`${BASE_URL}/api/recipient?customerId=DEMO001&location=Office`);
    const officeData = await officeRes.json();
    assert(officeRes.status === 200, 'Returns 200 OK');
    assert(officeData.authorizationStatus === 'AUTHORIZED', 'Authorization status is AUTHORIZED');
    assert(officeData.recipientName.includes('Security Desk'), 'Recipient is Security Desk');

    // 7. Case-insensitivity test (location=home in lowercase)
    console.log('\n[Test 7] GET /api/recipient?customerId=DEMO001&location=home (lowercase)');
    const lowerRes = await fetch(`${BASE_URL}/api/recipient?customerId=DEMO001&location=home`);
    const lowerData = await lowerRes.json();
    assert(lowerRes.status === 200, 'Case-insensitive match returns 200 OK');
    assert(lowerData.authorizationStatus === 'AUTHORIZED', 'Authorization status is AUTHORIZED');

    // 8. Safety check: Unregistered location -> NOT_AUTHORIZED
    console.log('\n[Test 8] GET /api/recipient?customerId=DEMO001&location=Gym (unregistered location)');
    const gymRes = await fetch(`${BASE_URL}/api/recipient?customerId=DEMO001&location=Gym`);
    const gymData = await gymRes.json();
    assert(gymRes.status === 200, 'Returns 200 OK');
    assert(gymData.authorizationStatus === 'NOT_AUTHORIZED', 'Safety Rule: Returns clear NOT_AUTHORIZED');
    assert(gymData.recipient === null, 'Safety Rule: recipient object is null');

    // 9. Safety check: Missing query params -> 400 Bad Request
    console.log('\n[Test 9] Missing query params validation');
    const missingParamsRes = await fetch(`${BASE_URL}/api/recipient`);
    assert(missingParamsRes.status === 400, 'Missing params returns 400 Bad Request');

    const missingLocationRes = await fetch(`${BASE_URL}/api/recipient?customerId=DEMO001`);
    assert(missingLocationRes.status === 400, 'Missing location returns 400 Bad Request');

    // 10. Safety check: Non-existent customer -> 404 with NOT_AUTHORIZED
    console.log('\n[Test 10] GET /api/recipient?customerId=FAKE999&location=Home');
    const fakeCustRes = await fetch(`${BASE_URL}/api/recipient?customerId=FAKE999&location=Home`);
    const fakeCustData = await fakeCustRes.json();
    assert(fakeCustRes.status === 404, 'Returns 404 for unknown customer');
    assert(fakeCustData.authorizationStatus === 'NOT_AUTHORIZED', 'Returns NOT_AUTHORIZED status');

    // 11. PUT /api/preferences/:customerId (Update mode to ASSIST)
    console.log('\n[Test 11] PUT /api/preferences/DEMO001 - Update mode to ASSIST');
    const updateModeRes = await fetch(`${BASE_URL}/api/preferences/DEMO001`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'ASSIST' })
    });
    const updateModeData = await updateModeRes.json();
    assert(updateModeRes.status === 200, 'Update mode returns 200 OK');
    assert(updateModeData.mode === 'ASSIST', 'Customer mode updated to ASSIST');

    // 12. PUT /api/preferences/:customerId (Invalid mode validation)
    console.log('\n[Test 12] PUT /api/preferences/DEMO001 - Invalid mode validation');
    const invalidModeRes = await fetch(`${BASE_URL}/api/preferences/DEMO001`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'INVALID_MODE' })
    });
    assert(invalidModeRes.status === 400, 'Invalid mode returns 400 Bad Request');

    // 13. PUT mode to OFF & verify proxy recipient returns NOT_AUTHORIZED
    console.log('\n[Test 13] PUT mode to OFF & verify proxy recipient returns NOT_AUTHORIZED');
    await fetch(`${BASE_URL}/api/preferences/DEMO001`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'OFF' })
    });
    const offRecipientRes = await fetch(`${BASE_URL}/api/recipient?customerId=DEMO001&location=Home`);
    const offRecipientData = await offRecipientRes.json();
    assert(offRecipientRes.status === 200, 'Returns 200 OK');
    assert(offRecipientData.authorizationStatus === 'NOT_AUTHORIZED', 'Mode OFF prevents proxy recipient delegation');

    // 14. POST /api/reset (Restore initial state)
    console.log('\n[Test 14] POST /api/reset - Restore initial seed data');
    const resetRes = await fetch(`${BASE_URL}/api/reset`, { method: 'POST' });
    const resetData = await resetRes.json();
    assert(resetRes.status === 200, 'Reset returns 200 OK');
    assert(resetData.success === true, 'Reset success is true');

    // ==========================================
    // SECTION 2: Model Context Protocol (MCP) Tests
    // ==========================================
    console.log('\n=========================================');
    console.log('🤖 PART 2: MCP PROTOCOL & TOOLS VERIFICATION');
    console.log('=========================================');

    console.log('\n[MCP Test 1] Connecting to MCP Server via SSE...');
    const mcpClientTransport = new SSEClientTransport(new URL(`${BASE_URL}/sse`));
    const mcpClient = new Client({ name: 'deliverease-test-client', version: '1.0.0' }, { capabilities: {} });
    await mcpClient.connect(mcpClientTransport);
    assert(true, 'MCP Client successfully connected over SSE');

    // 15. MCP Tool Discovery
    console.log('\n[MCP Test 2] Discovering MCP Tools...');
    const toolsResponse = await mcpClient.listTools();
    const toolNames = toolsResponse.tools.map(t => t.name);
    assert(toolNames.includes('get_preferences'), 'Tool "get_preferences" is exposed');
    assert(toolNames.includes('update_preferences'), 'Tool "update_preferences" is exposed');
    assert(toolNames.includes('get_authorized_recipient'), 'Tool "get_authorized_recipient" is exposed');
    assert(toolNames.length === 3, 'Exactly 3 Capability 1 MCP tools exposed');

    // 16. MCP Tool: get_preferences(DEMO001)
    console.log('\n[MCP Test 3] Calling tool: get_preferences("DEMO001")...');
    const mcpPrefResult = await mcpClient.callTool({
      name: 'get_preferences',
      arguments: { customerId: 'DEMO001' }
    });
    const parsedPref = JSON.parse(mcpPrefResult.content[0].text);
    assert(parsedPref.customerId === 'DEMO001', 'MCP returns customerId DEMO001');
    assert(parsedPref.mode === 'ACTIVE', 'MCP returns mode ACTIVE');
    assert(parsedPref.preferences.length === 3, 'MCP returns 3 preferences');

    // 17. MCP Tool: get_preferences(UNKNOWN)
    console.log('\n[MCP Test 4] Calling tool: get_preferences("NONEXISTENT")...');
    const mcpUnknownPref = await mcpClient.callTool({
      name: 'get_preferences',
      arguments: { customerId: 'NONEXISTENT' }
    });
    assert(mcpUnknownPref.isError === true, 'Returns tool error for non-existent customer');

    // 18. MCP Tool: get_authorized_recipient (Home -> Authorized)
    console.log('\n[MCP Test 5] Calling tool: get_authorized_recipient("DEMO001", "Home")...');
    const mcpHomeResult = await mcpClient.callTool({
      name: 'get_authorized_recipient',
      arguments: { customerId: 'DEMO001', location: 'Home' }
    });
    const parsedHome = JSON.parse(mcpHomeResult.content[0].text);
    assert(parsedHome.authorizationStatus === 'AUTHORIZED', 'Home returns AUTHORIZED');
    assert(parsedHome.recipientName.includes('Mummy'), 'Authorized recipient is Mummy');
    assert(parsedHome.recipientPhone === '+919876543210', 'Phone number is returned');

    // 19. MCP Tool: get_authorized_recipient (Hostel -> Authorized Self)
    console.log('\n[MCP Test 6] Calling tool: get_authorized_recipient("DEMO001", "Hostel")...');
    const mcpHostelResult = await mcpClient.callTool({
      name: 'get_authorized_recipient',
      arguments: { customerId: 'DEMO001', location: 'Hostel' }
    });
    const parsedHostel = JSON.parse(mcpHostelResult.content[0].text);
    assert(parsedHostel.authorizationStatus === 'AUTHORIZED', 'Hostel returns AUTHORIZED');
    assert(parsedHostel.recipientRelation === 'Self', 'Recipient relation is Self');

    // 20. MCP Tool: get_authorized_recipient (Office -> Authorized Security)
    console.log('\n[MCP Test 7] Calling tool: get_authorized_recipient("DEMO001", "Office")...');
    const mcpOfficeResult = await mcpClient.callTool({
      name: 'get_authorized_recipient',
      arguments: { customerId: 'DEMO001', location: 'Office' }
    });
    const parsedOffice = JSON.parse(mcpOfficeResult.content[0].text);
    assert(parsedOffice.authorizationStatus === 'AUTHORIZED', 'Office returns AUTHORIZED');
    assert(parsedOffice.recipientRelation === 'Security Desk', 'Recipient relation is Security Desk');

    // 21. MCP Tool: get_authorized_recipient (Gym -> NOT_AUTHORIZED safety check)
    console.log('\n[MCP Test 8] Calling tool: get_authorized_recipient("DEMO001", "Gym")...');
    const mcpGymResult = await mcpClient.callTool({
      name: 'get_authorized_recipient',
      arguments: { customerId: 'DEMO001', location: 'Gym' }
    });
    const parsedGym = JSON.parse(mcpGymResult.content[0].text);
    assert(parsedGym.authorizationStatus === 'NOT_AUTHORIZED', 'Safety check: Unregistered location returns NOT_AUTHORIZED');
    assert(parsedGym.recipient === null, 'Safety check: recipient object is null');

    // 22. MCP Tool: update_preferences(DEMO001, mode: "ASSIST")
    console.log('\n[MCP Test 9] Calling tool: update_preferences("DEMO001", "ASSIST")...');
    const mcpUpdateResult = await mcpClient.callTool({
      name: 'update_preferences',
      arguments: { customerId: 'DEMO001', mode: 'ASSIST' }
    });
    const parsedUpdate = JSON.parse(mcpUpdateResult.content[0].text);
    assert(parsedUpdate.mode === 'ASSIST', 'Customer mode updated to ASSIST via MCP tool');

    // Cross-verify: REST endpoint reflects MCP update
    const restAfterMcpUpdate = await fetch(`${BASE_URL}/api/preferences/DEMO001`);
    const restAfterMcpData = await restAfterMcpUpdate.json();
    assert(restAfterMcpData.mode === 'ASSIST', 'Shared State: REST endpoint sees mode update from MCP tool');

    // 23. MCP Tool: update_preferences(DEMO001, mode: "OFF") & verify proxy blocked
    console.log('\n[MCP Test 10] Calling tool: update_preferences("DEMO001", "OFF") and verifying safety block...');
    await mcpClient.callTool({
      name: 'update_preferences',
      arguments: { customerId: 'DEMO001', mode: 'OFF' }
    });
    const mcpBlockedResult = await mcpClient.callTool({
      name: 'get_authorized_recipient',
      arguments: { customerId: 'DEMO001', location: 'Home' }
    });
    const parsedBlocked = JSON.parse(mcpBlockedResult.content[0].text);
    assert(parsedBlocked.authorizationStatus === 'NOT_AUTHORIZED', 'Safety check: Mode OFF blocks proxy delivery via MCP');
    assert(parsedBlocked.recipient === null, 'Recipient is null when mode is OFF');

    // 24. MCP Client Close
    await mcpClient.close();
    assert(true, 'MCP Client session cleanly disconnected');

  } catch (err) {
    console.error('Test execution error:', err);
    failedCount++;
  } finally {
    server.close(() => {
      console.log('\n=========================================');
      console.log(`🏁 All Tests Complete: ${passedCount} Passed, ${failedCount} Failed`);
      console.log('=========================================');
      process.exit(failedCount > 0 ? 1 : 0);
    });
  }
}

server = app.listen(TEST_PORT, () => {
  runTests();
});
