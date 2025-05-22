 import axios from 'axios';

async function pingGoogle() {
  try {
    const response = await axios.get('https://www.google.com');
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ✅ Google pinged successfully: Status ${response.status}`);
  } catch (error) {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] ❌ Error pinging Google:`, error.message);
  }
}

// Ping immediately on start
pingGoogle();

// Then ping every 5 minutes
setInterval(pingGoogle, 5 * 60 * 1000);
