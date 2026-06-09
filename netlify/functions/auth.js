// Netlify serverless function — Authentication
// Ask RESPOND Medical | TASIS England
// Version: 1.2

exports.handler = async (event) => {
  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  }

  try {
    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch (_) {}

    const { password } = body;

    if (!password) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ success: false, error: 'Password required' }) };
    }

    const validPassword = process.env.BRENTWOOD_ACCESS_CODE;

    // If env var not set, log clearly and return config error (not wrong password)
    if (!validPassword) {
      console.error('BRENTWOOD_ACCESS_CODE environment variable is not set in Netlify.');
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, configError: true, error: 'Access code not configured on server. Contact your administrator.' }),
      };
    }

    const isValid = password.trim() === validPassword.trim();

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Cache-Control': 'no-store' },
      body: JSON.stringify({ success: isValid }),
    };

  } catch (error) {
    console.error('Auth error:', error.message);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, configError: true, error: 'Server error: ' + error.message }),
    };
  }
};
