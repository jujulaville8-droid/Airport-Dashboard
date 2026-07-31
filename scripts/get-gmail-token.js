// One-shot helper to get a Gmail OAuth refresh token.
// Usage:
//   1. Make sure .env.local has GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET set
//   2. Run: node -r dotenv/config scripts/get-gmail-token.js dotenv_config_path=.env.local
//   3. Open the printed URL in your browser and approve
//   4. Copy the printed refresh token into GMAIL_REFRESH_TOKEN in .env.local

import { google } from 'googleapis';
import * as http from 'node:http';
import * as url from 'node:url';

const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3456/callback';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('ERROR: GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET must be set in your environment.');
  console.error('Try: node -r dotenv/config scripts/get-gmail-token.js dotenv_config_path=.env.local');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

// Scopes required by the app:
//   - gmail.send    → src/lib/email.ts (schedule notifications, etc.)
//   - gmail.modify  → src/lib/gmail-inbox.ts — needs to read messages AND
//     create/apply labels (TailorsDaughter/Imported | Failed) for the cron
//     scanner. gmail.modify is a superset of gmail.readonly and is the
//     smallest scope that grants label creation.
//
// Adding a new scope to an existing refresh token is not possible — you
// must re-run this script and replace the token in Vercel entirely.
const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: [
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.modify',
  ],
});

// Start a temporary server to catch the callback
const server = http.createServer(async (req, res) => {
  const queryParams = url.parse(req.url, true).query;

  if (queryParams.code) {
    try {
      const { tokens } = await oauth2Client.getToken(queryParams.code);
      console.log('\n=== SUCCESS ===');
      console.log('Refresh Token:', tokens.refresh_token);
      console.log('\nAdd this to your .env.local:');
      console.log(`GMAIL_REFRESH_TOKEN=${tokens.refresh_token}`);
      console.log('================\n');

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>Success! You can close this tab.</h1><p>Go back to your terminal.</p>');
    } catch (err) {
      console.error('Error getting token:', err.message);
      res.writeHead(500);
      res.end('Error: ' + err.message);
    }
    setTimeout(() => server.close(), 1000);
  }
});

server.listen(3456, () => {
  console.log('\nOpen this URL in your browser:\n');
  console.log(authUrl);
  console.log('\nWaiting for authorization...\n');
});
