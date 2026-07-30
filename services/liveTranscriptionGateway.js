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

function sendMessage(socket, message) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function createTranscriptMessage({ transcript, isFinal }) {
  return {
    type: 'transcript',
    transcript,
    isFinal: Boolean(isFinal)
  };
}

function parseClientMessage(payload) {
  try {
    return JSON.parse(payload.toString());
  } catch {
    return null;
  }
}

function createRecognitionSession(socket, message, onEnd) {
  return googleSpeechService.startStreamingRecognition({
    sampleRateHertz: message.sampleRateHertz,
    onResult: (result) => sendMessage(socket, createTranscriptMessage(result)),
    onError: (error) => {
      sendMessage(socket, { type: 'error', message: error.message });
    },
    onEnd
  });
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
      if (session) {
        session.end();
        session = null;
      }
    };

    socket.on('message', (payload, isBinary) => {
      if (isBinary) {
        if (session) session.write(payload);
        return;
      }

      const message = parseClientMessage(payload);
      if (!message) {
        sendMessage(socket, {
          type: 'error',
          message: 'Invalid live transcription message.'
        });
        return;
      }

      if (message.type === 'start' && !session) {
        try {
          session = createRecognitionSession(socket, message, () => {
            session = null;
            sendMessage(socket, { type: 'ended' });
          });

          sendMessage(socket, { type: 'ready' });
        } catch (error) {
          sendMessage(socket, { type: 'error', message: error.message });
        }
      } else if (message.type === 'stop' && session && !stopped) {
        stopped = true;
        session.end();
      }
    });

    socket.on('close', cleanup);
    socket.on('error', cleanup);
  });
}

module.exports = {
  attachLiveTranscriptionGateway,
  createToken,
  _private: {
    createTranscriptMessage,
    parseClientMessage
  }
};
