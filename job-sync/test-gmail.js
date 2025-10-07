import WebSocket from 'ws';

const ws = new WebSocket('ws://127.0.0.1:8719');

ws.on('open', () => {
  console.log('Connected to MCP server');
  
  // Test Gmail polling
  const message = {
    jsonrpc: "2.0",
    id: "test-gmail",
    method: "tool/gmail.poll",
    params: {}
  };
  
  ws.send(JSON.stringify(message));
  console.log('Sent Gmail poll request');
});

ws.on('message', (data) => {
  const response = JSON.parse(data.toString());
  console.log('Response:', response);
  ws.close();
});

ws.on('error', (error) => {
  console.error('WebSocket error:', error);
});
