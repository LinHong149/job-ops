import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

async function findRejectionEmails() {
  try {
    console.log('Searching for rejection emails in primary inbox...');
    
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
    
    // Get all unread messages from primary inbox
    const query = encodeURIComponent("is:unread category:primary");
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=50`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    
    const data = await res.json();
    console.log(`\nFound ${data.messages?.length || 0} unread messages in primary inbox`);
    
    if (!data.messages || data.messages.length === 0) {
      console.log('No unread messages found');
      return;
    }
    
    const rejectionKeywords = [
      'unfortunately', 'regret to inform', 'not moving forward', 
      'not selected', 'not proceeding', 'rejection', 'declined', 'not a fit'
    ];
    
    const thankYouKeywords = [
      'thank you for applying', 'thanks for applying', 
      'thank you for your application', 'thanks for your application',
      'application received', 'application submitted'
    ];
    
    let rejectionCount = 0;
    let thankYouCount = 0;
    let otherCount = 0;
    
    console.log('\n--- Analyzing emails ---');
    
    for (const message of data.messages.slice(0, 20)) { // Check first 20 messages
      try {
        // Get message details
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
        
        const combined = (subject + ' ' + bodyText).toLowerCase();
        
        // Check for rejection keywords
        const isRejection = rejectionKeywords.some(keyword => combined.includes(keyword));
        const isThankYou = thankYouKeywords.some(keyword => combined.includes(keyword));
        
        if (isRejection) {
          rejectionCount++;
          console.log(`\n❌ REJECTION: "${subject}" from ${from}`);
          console.log(`   Body preview: ${bodyText.slice(0, 100)}...`);
        } else if (isThankYou) {
          thankYouCount++;
          console.log(`\n📧 THANK YOU: "${subject}" from ${from}`);
          console.log(`   Body preview: ${bodyText.slice(0, 100)}...`);
        } else {
          otherCount++;
          console.log(`\n📬 OTHER: "${subject}" from ${from}`);
        }
        
      } catch (error) {
        console.error(`Error processing message ${message.id}:`, error.message);
      }
    }
    
    console.log(`\n--- Summary ---`);
    console.log(`Rejections found: ${rejectionCount}`);
    console.log(`Thank you emails found: ${thankYouCount}`);
    console.log(`Other emails: ${otherCount}`);
    
  } catch (error) {
    console.error('Error:', error);
  }
}

findRejectionEmails();
