// Netlify serverless function — Feedback / Contact Form
// Ask RESPOND Medical | TASIS England
// Version: 1.0

const https = require('https');

const GOOGLE_SHEET_URL =
  'https://script.google.com/macros/s/AKfycbx9mkguGxKEOGuMi7Vc0aR43sqrScTqDWA03H2sW4Ain7jjrWDI0hYKh7bQdCnj1MKG/exec';

async function logFeedback(name, email, type, message) {
  try {
    const params = new URLSearchParams({
      source: 'AskRESPOND-Medical',
      type: 'FEEDBACK',
      question: `[${type || 'General'}] From: ${name || 'Anonymous'} <${email || 'no email'}>`,
      response: message || '',
      policies: 'n/a',
    });

    const url = `${GOOGLE_SHEET_URL}?${params.toString()}`;

    return new Promise((resolve) => {
      https
        .get(url, (res) => {
          if (res.statusCode === 302 || res.statusCode === 301) {
            https.get(res.headers.location, () => resolve());
          } else {
            resolve();
          }
        })
        .on('error', () => resolve());
    });
  } catch (e) {
    console.log('Feedback logging failed:', e);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    // Handle both JSON and form-encoded bodies
    let name, email, type, message;

    const contentType = event.headers['content-type'] || '';

    if (contentType.includes('application/json')) {
      const body = JSON.parse(event.body || '{}');
      name = body.name;
      email = body.email;
      type = body.type;
      message = body.message;
    } else {
      // URL-encoded form data
      const params = new URLSearchParams(event.body || '');
      name = params.get('name') || params.get('contactName');
      email = params.get('email') || params.get('contactEmail');
      type = params.get('type') || params.get('contactType');
      message = params.get('message') || params.get('contactMessage');
    }

    if (!message) {
      return {
        statusCode: 400,
        body: JSON.stringify({ success: false, error: 'Message is required' }),
      };
    }

    // Log feedback to Google Sheets (non-blocking)
    logFeedback(name, email, type, message).catch(() => {});

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true }),
    };
  } catch (error) {
    console.error('Contact handler error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: 'Server error' }),
    };
  }
};
