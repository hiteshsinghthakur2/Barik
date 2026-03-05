import 'dotenv/config';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import cookieParser from 'cookie-parser';
import axios from 'axios';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cookieParser());
  app.use(express.json());

  // --- API Routes ---

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Facebook OAuth: Get URL
  app.get('/api/auth/facebook/url', (req, res) => {
    const { client_id, client_secret } = req.query;
    
    // Use provided credentials or fallback to env
    const clientId = (client_id as string) || process.env.FACEBOOK_CLIENT_ID;
    const clientSecret = (client_secret as string) || process.env.FACEBOOK_CLIENT_SECRET;

    if (!clientId) {
      return res.status(400).json({ error: 'Missing Client ID' });
    }

    // We encode the credentials in the state parameter to persist them through the redirect
    // This allows the callback to know which secret to use without server-side sessions
    const stateData = {
      id: clientId,
      secret: clientSecret,
      nonce: Math.random().toString(36).substring(7)
    };
    const state = Buffer.from(JSON.stringify(stateData)).toString('base64');

    const redirectUri = `${process.env.APP_URL || `http://localhost:${PORT}`}/api/auth/facebook/callback`;
    
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      state: state,
      scope: 'public_profile,pages_manage_posts,pages_read_engagement', 
      response_type: 'code',
    });

    const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?${params.toString()}`;
    res.json({ url: authUrl });
  });

  // Facebook OAuth: Callback
  app.get('/api/auth/facebook/callback', async (req, res) => {
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

      const redirectUri = `${process.env.APP_URL || `http://localhost:${PORT}`}/api/auth/facebook/callback`;
      
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
  });

  // --- Vite Middleware ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
