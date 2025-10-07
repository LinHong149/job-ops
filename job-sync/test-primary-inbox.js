import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

async function testPrimaryInbox() {
  try {
    console.log('Testing primary inbox unread messages...');
    
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
    if (!tokenData.access_token) {
      console.error('Failed to get access token:', tokenData);
      return;
    }
    
    const accessToken = tokenData.access_token;
    console.log('✅ Got access token');
    
    // Test different queries to find primary inbox
    const queries = [
      'in:inbox is:unread',
      'in:primary is:unread', 
      'is:unread -in:social -in:promotions -in:updates -in:forums',
      'is:unread category:primary'
    ];
    
    for (const query of queries) {
      console.log(`\n--- Testing query: "${query}" ---`);
      const encodedQuery = encodeURIComponent(query);
      const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodedQuery}&maxResults=20`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      
      const data = await res.json();
      console.log(`Status: ${res.status}`);
      console.log(`Messages found: ${data.messages?.length || 0}`);
      
      if (data.messages && data.messages.length > 0) {
        console.log('First 5 message IDs:', data.messages.slice(0, 5).map(m => m.id));
        
        // Get details of first message
        const firstMsg = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${data.messages[0].id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        
        const msgData = await firstMsg.json();
        if (msgData.payload) {
          const subject = msgData.payload.headers?.find(h => h.name === 'Subject')?.value || 'No subject';
          const from = msgData.payload.headers?.find(h => h.name === 'From')?.value || 'Unknown sender';
          console.log(`Sample email: "${subject}" from ${from}`);
        }
      }
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

testPrimaryInbox();
