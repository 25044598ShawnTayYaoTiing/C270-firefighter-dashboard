const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');
const googleSpeechService = require('./googleSpeechService');

const tokens = new Map();
const TOKEN_TTL_MS = 60 * 1000;

function createToken(officerId) {
  const token = crypto.randomBytes(24).toString('base64url');
  tokens.set(token, { officerId, expiresAt: Date.now() + TOKEN_TTL_MS });
  return token;
}

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function attachLiveTranscriptionGateway(server) {
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname !== '/api/transcribe/stream') return;
    const token = url.searchParams.get('token');
    const entry = tokens.get(token);
    tokens.delete(token);
    if (!entry || entry.expiresAt < Date.now()) return socket.destroy();
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, entry));
  });

  wss.on('connection', (socket) => {
    let session;
    let stopped = false;
    const cleanup = () => {
      if (session) { session.end(); session = null; }
    };

    socket.on('message', (payload, isBinary) => {
      if (isBinary) {
        if (session) session.write(payload);
        return;
      }
      let message;
      try { message = JSON.parse(payload.toString()); } catch { return send(socket, { type: 'error', message: 'Invalid live transcription message.' }); }
      if (message.type === 'start' && !session) {
        try {
          session = googleSpeechService.startStreamingRecognition({
            sampleRateHertz: message.sampleRateHertz,
            onResult: ({ transcript, isFinal }) => send(socket, { type: 'transcript', transcript, isFinal }),
            onError: (error) => { send(socket, { type: 'error', message: error.message }); },
            onEnd: () => { session = null; send(socket, { type: 'ended' }); }
          });
          send(socket, { type: 'ready' });
        } catch (error) { send(socket, { type: 'error', message: error.message }); }
      } else if (message.type === 'stop' && session && !stopped) {
        stopped = true;
        session.end();
      }
    });
    socket.on('close', cleanup);
    socket.on('error', cleanup);
  });
}

module.exports = { attachLiveTranscriptionGateway, createToken };
