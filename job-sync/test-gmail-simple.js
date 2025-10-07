import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

async function testGmailAuth() {
  try {
    console.log('Testing Gmail authentication...');
    
    // Step 1: Get access token
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
    console.log('Token response:', tokenRes.status, tokenData);
    
    if (!tokenData.access_token) {
      console.error('Failed to get access token:', tokenData);
      return;
    }
    
    // Step 2: Test Gmail API
    const gmailRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    
    const gmailData = await gmailRes.json();
    console.log('Gmail profile response:', gmailRes.status, gmailData);
    
  } catch (error) {
    console.error('Error:', error);
  }
}

testGmailAuth();
