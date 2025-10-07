import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

async function detailedEmailAnalysis() {
  try {
    console.log('Detailed analysis of remaining unread emails...');
    
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
        // Get full message details with all parts
        const msgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}?format=full`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        
        const msgData = await msgRes.json();
        const payload = msgData.payload || {};
        
        console.log(`\n=== FULL EMAIL ANALYSIS ===`);
        console.log(`Message ID: ${message.id}`);
        
        // Extract all headers
        console.log(`\n--- HEADERS ---`);
        if (payload.headers) {
          payload.headers.forEach(header => {
            console.log(`${header.name}: ${header.value}`);
          });
        }
        
        // Extract subject and from
        const subject = payload.headers?.find(h => h.name.toLowerCase() === 'subject')?.value || 'No subject';
        const from = payload.headers?.find(h => h.name.toLowerCase() === 'from')?.value || 'Unknown sender';
        
        console.log(`\n--- CONTENT ANALYSIS ---`);
        console.log(`Subject: ${subject}`);
        console.log(`From: ${from}`);
        
        // Extract body text from all possible parts
        let bodyText = '';
        let htmlBody = '';
        
        function extractTextFromParts(parts) {
          if (!parts) return;
          
          for (const part of parts) {
            if (part.mimeType === 'text/plain' && part.body?.data) {
              bodyText = Buffer.from(part.body.data, 'base64').toString('utf8');
            }
            if (part.mimeType === 'text/html' && part.body?.data) {
              htmlBody = Buffer.from(part.body.data, 'base64').toString('utf8');
            }
            if (part.parts) {
              extractTextFromParts(part.parts);
            }
          }
        }
        
        extractTextFromParts(payload.parts);
        
        console.log(`\nPlain text body length: ${bodyText.length}`);
        console.log(`HTML body length: ${htmlBody.length}`);
        
        if (bodyText) {
          console.log(`\nPlain text body (first 1000 chars):`);
          console.log(bodyText.slice(0, 1000));
        }
        
        if (htmlBody) {
          console.log(`\nHTML body (first 1000 chars):`);
          console.log(htmlBody.slice(0, 1000));
        }
        
        // Check for rejection patterns in subject, plain text, and HTML
        const combined = (subject + ' ' + bodyText + ' ' + htmlBody).toLowerCase();
        
        const rejectionPatterns = [
          'unfortunately', 'regret to inform', 'not moving forward', 
          'not selected', 'not proceeding', 'rejection', 'declined', 'not a fit',
          'position closed', 'no longer', 'decided to move forward', 'other candidates',
          'not advance', 'not proceed', 'not continue', 'not move forward',
          'filled the position', 'position has been filled', 'selected another candidate',
          'update about your application', 'application update', 'status update'
        ];
        
        const foundPatterns = rejectionPatterns.filter(pattern => combined.includes(pattern));
        
        if (foundPatterns.length > 0) {
          console.log(`\n🎯 POTENTIAL REJECTION PATTERNS FOUND:`);
          foundPatterns.forEach(pattern => console.log(`   - "${pattern}"`));
        } else {
          console.log(`\n❌ No rejection patterns found`);
        }
        
        // Check if this looks like a rejection based on subject alone
        const subjectLower = subject.toLowerCase();
        if (subjectLower.includes('update') && (subjectLower.includes('application') || subjectLower.includes('your'))) {
          console.log(`\n⚠️  SUSPICIOUS: Subject contains "update" + "application" - likely a rejection`);
        }
        
        console.log(`\n${'='.repeat(60)}`);
        
      } catch (error) {
        console.error(`Error processing message ${message.id}:`, error.message);
      }
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

detailedEmailAnalysis();
