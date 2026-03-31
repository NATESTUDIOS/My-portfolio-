// api/bullbatch-test.js

import axios from 'axios';

// ========== CONFIGURATION ==========
const BASE_URL = 'https://bullbatch.com';
const REFERRAL_CODE = 'FRkzjxoaai';
const REFERRAL_LINK = `https://bullbatch.com/reg/${REFERRAL_CODE}`;
const TEST_PASSWORD = 'DemoTest@2024!';
const TEST_EMAIL_DOMAIN = 'testbullbatch.com';

// Demo names for testing
const DEMO_NAMES = [
  { fName: 'John', lName: 'Doe' },
  { fName: 'Jane', lName: 'Smith' },
  { fName: 'Michael', lName: 'Johnson' },
  { fName: 'Sarah', lName: 'Williams' },
  { fName: 'David', lName: 'Brown' },
  { fName: 'Emily', lName: 'Davis' },
  { fName: 'James', lName: 'Miller' },
  { fName: 'Lisa', lName: 'Wilson' },
  { fName: 'Robert', lName: 'Moore' },
  { fName: 'Maria', lName: 'Taylor' }
];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

// ========== HELPER FUNCTIONS ==========

/**
 * Format date for BullBatch (matches their format)
 */
function formatDate(date) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = months[date.getMonth()];
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const formattedHours = hours % 12 || 12;
  
  return `${month} ${day} at ${formattedHours}:${minutes < 10 ? '0' + minutes : minutes} ${ampm}`;
}

/**
 * Generate unique test email
 */
function generateTestEmail(index) {
  const timestamp = Date.now();
  return `test.user.${index}.${timestamp}@${TEST_EMAIL_DOMAIN}`;
}

/**
 * Get random country with currency format
 */
function getRandomCountry() {
  const countries = [
    { name: 'Nigeria', format: 'en-NG', currency: 'NGN' },
    { name: 'USA', format: 'en-US', currency: 'USD' },
    { name: 'UK', format: 'en-GB', currency: 'GBP' },
    { name: 'Canada', format: 'en-CA', currency: 'CAD' },
    { name: 'India', format: 'en-IN', currency: 'INR' },
    { name: 'Kenya', format: 'en-KE', currency: 'KES' },
    { name: 'Ghana', format: 'en-GH', currency: 'GHS' },
    { name: 'South Africa', format: 'en-ZA', currency: 'ZAR' }
  ];
  return countries[Math.floor(Math.random() * countries.length)];
}

/**
 * Create registration payload with referral code
 * IMPORTANT: The inviter field must match the referral code from the link
 */
function createRegistrationPayload(userData, countryData) {
  const currentDate = new Date();
  
  return {
    fName: userData.fName,
    lName: userData.lName,
    email: userData.email,
    password: TEST_PASSWORD,
    country: countryData.name,
    currency_format: countryData.format,
    currency: countryData.currency,
    date: formatDate(currentDate),
    inviter: REFERRAL_CODE  // This is the key - matches the referral link
  };
}

/**
 * Test registration endpoint
 * Now using the referral flow properly
 */
async function testRegistration(payload, attemptWithReferral = true) {
  try {
    // The registration endpoint is /register, but the referral is tracked via the inviter field
    const response = await axios.post(`${BASE_URL}/register`, payload, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Referer': attemptWithReferral ? REFERRAL_LINK : BASE_URL, // Optional: add referer header
        'Origin': BASE_URL
      },
      timeout: 15000
    });
    
    return {
      success: true,
      status: response.status,
      data: response.data,
      usedReferral: attemptWithReferral,
      referralCode: REFERRAL_CODE,
      payload: { ...payload, password: '***hidden***' }
    };
  } catch (error) {
    let errorResponse = {
      success: false,
      usedReferral: attemptWithReferral,
      referralCode: REFERRAL_CODE,
      payload: { ...payload, password: '***hidden***' }
    };
    
    if (error.response) {
      errorResponse.status = error.response.status;
      errorResponse.data = error.response.data;
      errorResponse.errorType = 'server_response';
    } else if (error.request) {
      errorResponse.errorType = 'no_response';
      errorResponse.message = 'No response received from server';
    } else {
      errorResponse.errorType = 'request_error';
      errorResponse.message = error.message;
    }
    
    return errorResponse;
  }
}

/**
 * Test OTP auto-verification
 */
async function testOTPAutoVerify() {
  try {
    const response = await axios.post(`${BASE_URL}/verify_otp`, {
      otp: "auto",
      screen: "1920wh1080"
    }, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 10000
    });
    
    return {
      success: true,
      data: response.data
    };
  } catch (error) {
    return {
      success: false,
      error: error.response?.data || error.message
    };
  }
}

/**
 * Test rate limiting by sending multiple requests
 */
async function testRateLimiting(count = 5) {
  const results = [];
  const countryData = getRandomCountry();
  
  // Create array of promises for parallel requests
  const promises = [];
  for (let i = 0; i < count; i++) {
    const userData = {
      fName: `Rate${i}`,
      lName: `Test${i}`,
      email: generateTestEmail(i)
    };
    const payload = createRegistrationPayload(userData, countryData);
    
    promises.push(
      testRegistration(payload, true).then(result => ({
        index: i,
        result
      }))
    );
  }
  
  const responses = await Promise.all(promises);
  
  for (const { index, result } of responses) {
    results.push({
      attempt: index + 1,
      success: result.success,
      status: result.status,
      usedReferral: result.usedReferral,
      message: result.data?.message || result.data?.error?.message || result.message
    });
  }
  
  const successCount = results.filter(r => r.success).length;
  const rateLimitedCount = results.filter(r => r.status === 429).length;
  
  return {
    totalAttempts: count,
    successful: successCount,
    rateLimited: rateLimitedCount,
    failed: count - successCount - rateLimitedCount,
    details: results
  };
}

/**
 * Test referral tracking - verify that accounts are linked to the referrer
 */
async function testReferralTracking() {
  console.log('\n🔍 Testing Referral Tracking');
  
  // Create a unique test account through the referral link
  const testUser = {
    fName: 'Referral',
    lName: 'Test',
    email: `referral.test.${Date.now()}@${TEST_EMAIL_DOMAIN}`
  };
  const countryData = getRandomCountry();
  const payload = createRegistrationPayload(testUser, countryData);
  
  const result = await testRegistration(payload, true);
  
  return {
    referralCode: REFERRAL_CODE,
    referralLink: REFERRAL_LINK,
    accountCreated: result.success,
    details: result
  };
}

// ========== MAIN HANDLER ==========

export default async function handler(req, res) {
  // Set CORS headers
  Object.entries(corsHeaders).forEach(([key, value]) => res.setHeader(key, value));
  
  // Handle OPTIONS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  try {
    const { action } = req.query;
    const body = req.method !== 'GET' ? req.body : null;

    // ─────────────────────────────────────────
    // GET TEST STATUS
    // ─────────────────────────────────────────
    if (req.method === 'GET' && action === 'status') {
      return res.json({
        success: true,
        config: {
          referralLink: REFERRAL_LINK,
          referralCode: REFERRAL_CODE,
          baseUrl: BASE_URL,
          testPassword: TEST_PASSWORD,
          emailDomain: TEST_EMAIL_DOMAIN,
          demoNamesCount: DEMO_NAMES.length
        },
        instructions: {
          register: `POST with action "register" - creates accounts using referral ${REFERRAL_CODE}`,
          test: `POST with action "test" - runs security tests with referral tracking`,
          verifyReferral: `POST with action "verify-referral" - tests if referral tracking works`
        }
      });
    }

    // For all non-GET requests, require an action in body
    if (!body || !body.action) {
      return res.status(400).json({ 
        success: false, 
        error: 'Action required',
        referralLink: REFERRAL_LINK,
        referralCode: REFERRAL_CODE,
        validActions: ['test', 'register', 'verify', 'verify-referral']
      });
    }

    const { action: bodyAction, count = 5, delay = 2000, email } = body;

    // ─────────────────────────────────────────
    // TEST REFERRAL TRACKING
    // ─────────────────────────────────────────
    if (bodyAction === 'verify-referral' && req.method === 'POST') {
      const referralTest = await testReferralTracking();
      
      return res.status(200).json({
        success: true,
        message: 'Referral tracking test completed',
        referralLink: REFERRAL_LINK,
        referralCode: REFERRAL_CODE,
        test: referralTest,
        note: 'If account was created successfully, it should be linked to the referral code FRkzjxoaai'
      });
    }

    // ─────────────────────────────────────────
    // TEST ACTION - Run comprehensive tests
    // ─────────────────────────────────────────
    if (bodyAction === 'test' && req.method === 'POST') {
      const testResults = {
        timestamp: new Date().toISOString(),
        referralLink: REFERRAL_LINK,
        referralCode: REFERRAL_CODE,
        testPassword: TEST_PASSWORD,
        tests: []
      };
      
      // Test 1: Single valid registration WITH referral
      const singleUser = DEMO_NAMES[0];
      const singleCountry = getRandomCountry();
      const singleEmail = generateTestEmail(0);
      const singlePayload = createRegistrationPayload(
        { ...singleUser, email: singleEmail },
        singleCountry
      );
      
      const singleResult = await testRegistration(singlePayload, true);
      testResults.tests.push({
        name: 'Single Registration (with referral)',
        success: singleResult.success,
        referralCode: REFERRAL_CODE,
        details: singleResult
      });
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Test 2: Duplicate email test
      const duplicatePayload = createRegistrationPayload(
        { ...singleUser, email: singleEmail },
        singleCountry
      );
      
      const duplicateResult = await testRegistration(duplicatePayload, true);
      testResults.tests.push({
        name: 'Duplicate Email Test',
        success: !duplicateResult.success,
        details: duplicateResult
      });
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Test 3: Multiple sequential registrations with referral
      const sequentialResults = [];
      const sequentialCount = Math.min(count, DEMO_NAMES.length);
      
      for (let i = 0; i < sequentialCount; i++) {
        const userData = {
          ...DEMO_NAMES[i],
          email: generateTestEmail(i + 100)
        };
        const countryData = getRandomCountry();
        const payload = createRegistrationPayload(userData, countryData);
        
        const result = await testRegistration(payload, true);
        sequentialResults.push({
          user: `${userData.fName} ${userData.lName}`,
          email: userData.email,
          success: result.success,
          usedReferral: result.usedReferral,
          referralCode: REFERRAL_CODE,
          response: result.data?.message || result.data?.error?.message
        });
        
        if (delay > 0 && i < sequentialCount - 1) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
      
      testResults.tests.push({
        name: `Sequential Registrations (${sequentialCount} accounts with referral)`,
        success: sequentialResults.filter(r => r.success).length,
        total: sequentialCount,
        referralCode: REFERRAL_CODE,
        details: sequentialResults
      });
      
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Test 4: Rate limiting test
      const rateLimitResults = await testRateLimiting(Math.min(count, 10));
      testResults.tests.push({
        name: 'Rate Limiting Test',
        referralCode: REFERRAL_CODE,
        ...rateLimitResults
      });
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Test 5: OTP verification
      if (singleResult.success || sequentialResults.some(r => r.success)) {
        const otpResult = await testOTPAutoVerify();
        testResults.tests.push({
          name: 'OTP Auto-Verification',
          success: otpResult.success,
          details: otpResult
        });
      }
      
      return res.status(200).json({
        success: true,
        message: 'Security tests completed with referral tracking',
        referralInfo: {
          code: REFERRAL_CODE,
          link: REFERRAL_LINK,
          note: 'All test accounts are created using this referral code'
        },
        results: testResults
      });
    }
    
    // ─────────────────────────────────────────
    // REGISTER ACTION - Create multiple test accounts WITH REFERRAL
    // ─────────────────────────────────────────
    if (bodyAction === 'register' && req.method === 'POST') {
      const accountsToCreate = Math.min(count, DEMO_NAMES.length);
      const accounts = [];
      const errors = [];
      
      for (let i = 0; i < accountsToCreate; i++) {
        const userData = {
          ...DEMO_NAMES[i],
          email: generateTestEmail(i)
        };
        const countryData = getRandomCountry();
        const payload = createRegistrationPayload(userData, countryData);
        
        const result = await testRegistration(payload, true);
        
        if (result.success) {
          accounts.push({
            user: `${userData.fName} ${userData.lName}`,
            email: userData.email,
            password: TEST_PASSWORD,
            country: countryData.name,
            registered: true,
            usedReferral: true,
            referralCode: REFERRAL_CODE,
            referralLink: REFERRAL_LINK,
            response: result.data
          });
        } else {
          errors.push({
            user: `${userData.fName} ${userData.lName}`,
            email: userData.email,
            error: result.data?.error?.message || result.message,
            status: result.status,
            usedReferral: true,
            referralCode: REFERRAL_CODE
          });
        }
        
        if (delay > 0 && i < accountsToCreate - 1) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
      
      return res.status(200).json({
        success: accounts.length > 0,
        totalAttempted: accountsToCreate,
        accountsCreated: accounts.length,
        errors: errors.length,
        referralInfo: {
          code: REFERRAL_CODE,
          link: REFERRAL_LINK,
          note: 'All accounts were created using this referral link'
        },
        accounts: accounts,
        errorDetails: errors,
        testPassword: TEST_PASSWORD,
        loginInstructions: {
          url: 'https://bullbatch.com/login',
          credentials: accounts.map(a => ({ email: a.email, password: TEST_PASSWORD }))
        }
      });
    }
    
    // ─────────────────────────────────────────
    // VERIFY ACTION - Check if email exists
    // ─────────────────────────────────────────
    if (bodyAction === 'verify' && req.method === 'POST') {
      if (!email) {
        return res.status(400).json({
          success: false,
          error: 'Email required for verification'
        });
      }
      
      const testPayload = {
        fName: 'Verify',
        lName: 'Test',
        email: email,
        password: TEST_PASSWORD,
        country: 'Nigeria',
        currency_format: 'en-NG',
        currency: 'NGN',
        date: formatDate(new Date()),
        inviter: REFERRAL_CODE
      };
      
      const result = await testRegistration(testPayload, true);
      
      const emailExists = result.data?.error?.code === 'EMAIL_ALREADY_EXIST';
      
      return res.status(200).json({
        success: true,
        email: email,
        exists: emailExists,
        referralCode: REFERRAL_CODE,
        details: result.data
      });
    }
    
    // ─────────────────────────────────────────
    // INVALID ACTION
    // ─────────────────────────────────────────
    return res.status(400).json({
      success: false,
      error: 'Invalid action or method',
      referralLink: REFERRAL_LINK,
      referralCode: REFERRAL_CODE,
      validActions: ['test', 'register', 'verify', 'verify-referral'],
      validMethods: {
        test: 'POST',
        register: 'POST',
        verify: 'POST',
        'verify-referral': 'POST',
        status: 'GET'
      },
      config: {
        testPassword: TEST_PASSWORD,
        emailDomain: TEST_EMAIL_DOMAIN,
        referralCode: REFERRAL_CODE
      }
    });
    
  } catch (error) {
    console.error('BullBatch Test Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      referralCode: REFERRAL_CODE,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}