/**
 * Comprehensive Test Suite for DeliverEase Capability 1 Mock Server
 */
const http = require('http');
const app = require('./server');

const TEST_PORT = 3099;
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
  console.log('🧪 Starting DeliverEase Capability 1 API Tests...\n');

  try {
    // 1. Health check
    console.log('[Test 1] GET /health');
    const healthRes = await fetch(`${BASE_URL}/health`);
    const healthData = await healthRes.json();
    assert(healthRes.status === 200, 'Health endpoint returns 200 OK');
    assert(healthData.status === 'UP', 'Health status is UP');
    assert(Array.isArray(healthData.capabilities), 'Capabilities list returned');

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

    // 13. PUT mode to OFF -> Proxy delivery turns NOT_AUTHORIZED
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

    // 14. PUT add new location preference (e.g. Neighbor)
    console.log('\n[Test 14] PUT /api/preferences/DEMO001 - Add new preference location');
    const addPrefRes = await fetch(`${BASE_URL}/api/preferences/DEMO001`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        location: 'Neighbor',
        recipientName: 'Mr. Verma',
        recipientRelation: 'Neighbor (Flat 302)',
        recipientPhone: '+919834567890',
        preferredTime: 'Anytime',
        authorizationStatus: 'AUTHORIZED'
      })
    });
    assert(addPrefRes.status === 200, 'Adding new preference returns 200 OK');

    // Reset mode back to ACTIVE to test neighbor
    await fetch(`${BASE_URL}/api/preferences/DEMO001`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'ACTIVE' })
    });
    const neighborRes = await fetch(`${BASE_URL}/api/recipient?customerId=DEMO001&location=Neighbor`);
    const neighborData = await neighborRes.json();
    assert(neighborData.authorizationStatus === 'AUTHORIZED', 'Neighbor is now authorized');
    assert(neighborData.recipientName === 'Mr. Verma', 'Neighbor recipientName matches');

    // 15. POST /api/reset (Reset demo state)
    console.log('\n[Test 15] POST /api/reset - Restore initial seed data');
    const resetRes = await fetch(`${BASE_URL}/api/reset`, { method: 'POST' });
    const resetData = await resetRes.json();
    assert(resetRes.status === 200, 'Reset returns 200 OK');
    assert(resetData.success === true, 'Reset success is true');

    const verifyResetRes = await fetch(`${BASE_URL}/api/preferences/DEMO001`);
    const verifyResetData = await verifyResetRes.json();
    assert(verifyResetData.mode === 'ACTIVE', 'Mode restored to ACTIVE');
    assert(verifyResetData.preferences.length === 3, 'Preferences length restored to 3');

  } catch (err) {
    console.error('Test execution error:', err);
    failedCount++;
  } finally {
    server.close(() => {
      console.log('\n=========================================');
      console.log(`🏁 Tests Complete: ${passedCount} Passed, ${failedCount} Failed`);
      console.log('=========================================');
      process.exit(failedCount > 0 ? 1 : 0);
    });
  }
}

server = app.listen(TEST_PORT, () => {
  runTests();
});
