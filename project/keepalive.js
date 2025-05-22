// keepalive.js
import express from 'express';

const app = express();

app.get('/', (req, res) => {
  res.send('✅ Bot is alive');
});

app.listen(4000, '0.0.0.0', () => {
  console.log('🟢 Keepalive server running on http://0.0.0.0:3000');
});
