require('dotenv').config();
const express = require('express');
const cors = require('cors');

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
// In-Memory Data Store (Capability 1 Seed Data)
// ==========================================
const VALID_MODES = ['ACTIVE', 'ASSIST', 'OFF'];
const VALID_AUTH_STATUSES = ['AUTHORIZED', 'NOT_AUTHORIZED'];

const getInitialSeedData = () => ({
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

let customersStore = getInitialSeedData();

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
// API Routes
// ==========================================

/**
 * Health Check Endpoint
 * GET /health
 */
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'UP',
    service: 'DeliverEase Mock Server',
    version: '1.0.0',
    capabilities: [
      'CAPABILITY 1 — Trusted Recipient & Delivery Preferences'
    ],
    timestamp: new Date().toISOString()
  });
});

/**
 * 1. GET /api/preferences/:customerId
 * Return the customer's current delivery mode and saved preferences.
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
 * Update customer delivery mode and/or preferences.
 * Supports partial updates: mode, full preferences array, or single preference object.
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

  // Case A: Full preferences array provided
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

    // Clean and normalize preferences
    existingCustomer.preferences = preferences.map(p => ({
      location: p.location.trim(),
      recipientName: p.recipientName ? p.recipientName.trim() : '',
      recipientRelation: p.recipientRelation ? p.recipientRelation.trim() : '',
      recipientPhone: p.recipientPhone ? p.recipientPhone.trim() : '',
      preferredTime: p.preferredTime ? p.preferredTime.trim() : '',
      authorizationStatus: p.authorizationStatus ? p.authorizationStatus.trim().toUpperCase() : 'AUTHORIZED'
    }));
  }
  // Case B: Single preference object provided directly in body with 'location'
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

  // Safety check: ensure at least one valid field was updated
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
 * Query params: customerId, location
 * Return the authorized recipient for that delivery location.
 *
 * Safety Rules Enforced:
 * - Never invent an authorized recipient.
 * - If no authorized recipient exists, return a clear NOT_AUTHORIZED result.
 * - Never expose unnecessary data.
 * - Validate all inputs.
 */
app.get('/api/recipient', (req, res) => {
  const { customerId, location } = req.query;

  // Validate required query parameters
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

  // Validate customer existence
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

  // Safety Rule: If customer delivery mode is OFF, proxy delivery is disabled
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

  // Find matching location preference (case-insensitive)
  const matchedPref = customer.preferences.find(
    p => p.location.trim().toLowerCase() === cleanLocation.toLowerCase()
  );

  // Safety Rule: Never invent an authorized recipient. If not found or not authorized, return clear NOT_AUTHORIZED
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

  // Authorized Recipient Response - Only expose necessary coordination data
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

/**
 * Reset Demo Data Helper (Hackathon utility)
 * POST /api/reset
 */
app.post('/api/reset', (req, res) => {
  customersStore = getInitialSeedData();
  res.status(200).json({
    success: true,
    message: 'Demo customer data reset to initial state.',
    customers: Object.keys(customersStore)
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
      'GET /api/preferences/:customerId',
      'PUT /api/preferences/:customerId',
      'GET /api/recipient?customerId=...&location=...',
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
    console.log(`🚀 DeliverEase Mock Server running at http://${HOST}:${PORT}`);
    console.log(`📡 Health Check : http://${HOST}:${PORT}/health`);
    console.log(`📦 Capability 1 : Trusted Recipient & Delivery Preferences`);
    console.log(`📋 Demo Customer: DEMO001 (Home, Hostel, Office)`);
    console.log(`===================================================`);
  });
}

module.exports = app;
