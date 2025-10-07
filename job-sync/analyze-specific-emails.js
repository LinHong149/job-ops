import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

async function analyzeSpecificEmails() {
  try {
    console.log('Analyzing specific emails for rejection patterns...');
    
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
    
    // Get all unread messages from primary inbox
    const query = encodeURIComponent("is:unread category:primary");
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=50`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    
    const data = await res.json();
    console.log(`Found ${data.messages?.length || 0} unread messages`);
    
    if (!data.messages || data.messages.length === 0) {
      console.log('No unread messages found');
      return;
    }
    
    for (const message of data.messages) {
      try {
        // Get full message details
        const msgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}?format=full`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        
        const msgData = await msgRes.json();
        const payload = msgData.payload || {};
        
        // Extract headers
        const subject = payload.headers?.find(h => h.name.toLowerCase() === 'subject')?.value || 'No subject';
        const from = payload.headers?.find(h => h.name.toLowerCase() === 'from')?.value || 'Unknown sender';
        
        // Extract body text
        let bodyText = '';
        if (payload.parts) {
          for (const part of payload.parts) {
            if (part.mimeType === 'text/plain' && part.body?.data) {
              bodyText = Buffer.from(part.body.data, 'base64').toString('utf8');
              break;
            }
            if (part.parts) {
              for (const subPart of part.parts) {
                if (subPart.mimeType === 'text/plain' && subPart.body?.data) {
                  bodyText = Buffer.from(subPart.body.data, 'base64').toString('utf8');
                  break;
                }
              }
            }
          }
        }
        
        console.log(`\n=== EMAIL ANALYSIS ===`);
        console.log(`Subject: ${subject}`);
        console.log(`From: ${from}`);
        console.log(`Body (first 500 chars):`);
        console.log(bodyText.slice(0, 500));
        console.log(`\nFull body length: ${bodyText.length} characters`);
        
        // Check for various rejection patterns
        const combined = (subject + ' ' + bodyText).toLowerCase();
        
        const rejectionPatterns = [
          'unfortunately', 'regret to inform', 'not moving forward', 
          'not selected', 'not proceeding', 'rejection', 'declined', 'not a fit',
          'position closed', 'no longer', 'decided to move forward', 'other candidates',
          'not advance', 'not proceed', 'not continue', 'not move forward',
          'filled the position', 'position has been filled', 'selected another candidate'
        ];
        
        const foundPatterns = rejectionPatterns.filter(pattern => combined.includes(pattern));
        
        if (foundPatterns.length > 0) {
          console.log(`\n🎯 POTENTIAL REJECTION PATTERNS FOUND:`);
          foundPatterns.forEach(pattern => console.log(`   - "${pattern}"`));
        } else {
          console.log(`\n❌ No rejection patterns found`);
        }
        
        console.log(`\n${'='.repeat(50)}`);
        
      } catch (error) {
        console.error(`Error processing message ${message.id}:`, error.message);
      }
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

analyzeSpecificEmails();
