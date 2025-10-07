import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

async function debugGmailQuery() {
  try {
    console.log('Testing different Gmail queries...');
    
    // Get access token
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GMAIL_CLIENT_ID,
        client_secret: process.env.GMAIL_CLIENT_SECRET,
        refresh_token: process.env.GMAIL_REFRESH_TOKEN,
        grant_type: "refresh_token"
      })
    });
    
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    
    // Test different queries
    const queries = [
      'in:inbox is:unread',
      'in:inbox is:unread -in:social -in:promotions -in:updates -in:forums',
      'is:unread',
      'in:inbox'
    ];
    
    for (const query of queries) {
      const encodedQuery = encodeURIComponent(query);
      const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodedQuery}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      
      const data = await res.json();
      console.log(`\nQuery: "${query}"`);
      console.log(`Status: ${res.status}`);
      console.log(`Messages found: ${data.messages?.length || 0}`);
      
      if (data.messages && data.messages.length > 0) {
        console.log('First few message IDs:', data.messages.slice(0, 3).map(m => m.id));
      }
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

debugGmailQuery();
