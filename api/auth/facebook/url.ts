import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  // Facebook OAuth: Get URL
  const { client_id, client_secret, redirect_uri } = req.query;
  
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

  // Determine redirect URI
  // 1. Prefer the one passed from client (guarantees match with what user sees)
  // 2. Fallback to server-side construction
  let finalRedirectUri = redirect_uri as string;

  if (!finalRedirectUri) {
    // In Vercel, req.headers.host gives the domain
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host;
    const baseUrl = `${protocol}://${host}`;
    finalRedirectUri = `${process.env.APP_URL || baseUrl}/api/auth/facebook/callback`;
  }
  
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: finalRedirectUri,
    state: state,
    scope: 'public_profile,pages_manage_posts,pages_read_engagement,pages_show_list', 
    response_type: 'code',
  });

  const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?${params.toString()}`;
  res.json({ url: authUrl });
}
