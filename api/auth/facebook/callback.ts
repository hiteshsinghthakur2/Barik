import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { code, state } = req.query;
  
  if (!code) {
    return res.status(400).send('No code provided');
  }

  try {
    let clientId = process.env.FACEBOOK_CLIENT_ID;
    let clientSecret = process.env.FACEBOOK_CLIENT_SECRET;

    // Try to extract credentials from state
    if (state) {
      try {
        const stateData = JSON.parse(Buffer.from(state.toString(), 'base64').toString());
        if (stateData.id && stateData.secret) {
          clientId = stateData.id;
          clientSecret = stateData.secret;
        }
      } catch (e) {
        console.warn('Failed to parse state parameter');
      }
    }

    if (!clientId || !clientSecret) {
      return res.status(400).send('Missing App Credentials. Please restart the login process.');
    }

    // Determine redirect URI based on environment
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host;
    const baseUrl = `${protocol}://${host}`;
    
    const redirectUri = `${process.env.APP_URL || baseUrl}/api/auth/facebook/callback`;
    
    // Exchange code for access token
    const tokenResponse = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
      params: {
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code: code.toString(),
      },
    });

    const accessToken = tokenResponse.data.access_token;

    // Get user info to verify
    const userResponse = await axios.get('https://graph.facebook.com/me', {
      params: {
        fields: 'id,name,picture',
        access_token: accessToken,
      },
    });

    const user = userResponse.data;
    
    const successHtml = `
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ 
                type: 'OAUTH_AUTH_SUCCESS', 
                user: ${JSON.stringify(user)},
                accessToken: '${accessToken}'
              }, '*');
              window.close();
            } else {
              document.body.innerHTML = 'Authentication successful. You can close this window.';
            }
          </script>
          <p>Authentication successful. Closing...</p>
        </body>
      </html>
    `;
    
    res.send(successHtml);

  } catch (error: any) {
    console.error('Facebook Auth Error:', error.response?.data || error.message);
    res.status(500).send(`Authentication failed: ${error.response?.data?.error?.message || error.message}`);
  }
}
