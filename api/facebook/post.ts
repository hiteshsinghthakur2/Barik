import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import FormData from 'form-data';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { accessToken, message, videoUrl } = req.body;

  if (!accessToken || !message) {
    return res.status(400).json({ error: 'Missing access token or message' });
  }

  try {
    // 1. Get User Pages
    const pagesResponse = await axios.get(`https://graph.facebook.com/v18.0/me/accounts`, {
      params: { access_token: accessToken }
    });
    
    const pagesData = pagesResponse.data;

    if (!pagesData.data || pagesData.data.length === 0) {
      return res.status(400).json({ error: 'No Facebook Pages found for this user.' });
    }

    // For now, just pick the first page. In a real app, user would select.
    const page = pagesData.data[0];
    const pageAccessToken = page.access_token;
    const pageId = page.id;

    console.log(`Posting to page: ${page.name} (${pageId})`);

    let postResponse;

    if (videoUrl) {
      // 2a. Post Video
      const formData = new FormData();
      formData.append('access_token', pageAccessToken);
      formData.append('description', message);

      if (videoUrl.startsWith('data:') || videoUrl.length > 1000) {
        // Assume Base64 data
        const base64Data = videoUrl.split(',')[1];
        const binaryData = Buffer.from(base64Data, 'base64');
        formData.append('source', binaryData, { filename: 'video.mp4', contentType: 'video/mp4' });
      } else {
        // Assume public URL (fallback)
        formData.append('file_url', videoUrl);
      }

      const response = await axios.post(`https://graph.facebook.com/v18.0/${pageId}/videos`, formData, {
        headers: {
          ...formData.getHeaders(),
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });
      postResponse = response.data;

    } else {
      // 2b. Post Text/Link
      const response = await axios.post(`https://graph.facebook.com/v18.0/${pageId}/feed`, null, {
        params: {
          access_token: pageAccessToken,
          message: message,
        }
      });
      postResponse = response.data;
    }

    return res.status(200).json({ 
      success: true, 
      postId: postResponse.id,
      pageName: page.name 
    });

  } catch (error: any) {
    console.error('Facebook API Error:', error.response?.data || error.message);
    return res.status(500).json({ 
      error: error.response?.data?.error?.message || error.message 
    });
  }
}
