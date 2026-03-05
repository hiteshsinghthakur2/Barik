import type { VercelRequest, VercelResponse } from '@vercel/node';

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
    const pagesResponse = await fetch(`https://graph.facebook.com/v18.0/me/accounts?access_token=${accessToken}`);
    const pagesData = await pagesResponse.json();

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
      // We receive the video as a Base64 data URI or a public URL.
      // If it's a data URI (starts with data:), we need to upload it as a file.
      
      const formData = new FormData();
      formData.append('access_token', pageAccessToken);
      formData.append('description', message);

      if (videoUrl.startsWith('data:') || videoUrl.length > 1000) {
        // Assume Base64 data
        // Extract the base64 part
        const base64Data = videoUrl.split(',')[1];
        const binaryData = Buffer.from(base64Data, 'base64');
        const blob = new Blob([binaryData], { type: 'video/mp4' });
        formData.append('source', blob, 'video.mp4');
      } else {
        // Assume public URL (fallback)
        formData.append('file_url', videoUrl);
      }

      const response = await fetch(`https://graph.facebook.com/v18.0/${pageId}/videos`, {
        method: 'POST',
        body: formData,
      });
      postResponse = await response.json();

    } else {
      // 2b. Post Text/Link
      const feedParams = new URLSearchParams({
        access_token: pageAccessToken,
        message: message,
      });

      const response = await fetch(`https://graph.facebook.com/v18.0/${pageId}/feed?${feedParams.toString()}`, {
        method: 'POST',
      });
      postResponse = await response.json();
    }

    if (postResponse.error) {
      console.error('Facebook API Error:', postResponse.error);
      return res.status(500).json({ error: postResponse.error.message });
    }

    return res.status(200).json({ 
      success: true, 
      postId: postResponse.id,
      pageName: page.name 
    });

  } catch (error: any) {
    console.error('Server Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
