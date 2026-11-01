// karma-gateway.js — rode com: node karma-gateway.js
// npm init -y && npm i @whiskeysockets/baileys express
// (adicione "type": "module" no package.json)

import express from 'express';
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
} from '@whiskeysockets/baileys';

const PORT = process.env.PORT || 8080;
const KARMA_KEY = process.env.KARMA_KEY;      // a mesma chave que você colar no painel
const APP_WEBHOOK = process.env.APP_WEBHOOK;  // https://SEU-APP.base44.app/functions/whatsappWebhook

if (!KARMA_KEY || !APP_WEBHOOK) {
  console.error('Defina KARMA_KEY e APP_WEBHOOK no ambiente.');
  process.exit(1);
}

let sock = null;
let qr = null;
let connected = false;
let phone = null;

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('sessao-karma');
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({ version, auth: state, browser: ['Karma', 'Chrome', '1.0'] });
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    if (update.qr) qr = update.qr;
    if (update.connection === 'open') {
      connected = true;
      qr = null;
      phone = sock.user?.id?.split(':')[0] || null;
      console.log('Conectado como', phone);
    }
    if (update.connection === 'close') {
      connected = false;
      const code = update.lastDisconnect?.error?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) start();
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      const from = msg.key?.remoteJid;
      if (!msg.message || msg.key.fromMe || !from || from === 'status@broadcast') continue;

      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        '';
      if (!text.trim()) continue;

      try {
        const response = await fetch(APP_WEBHOOK, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-karma-key': KARMA_KEY },
          body: JSON.stringify({
            from,
            name: msg.pushName || 'Membro',
            text,
            isGroup: from.endsWith('@g.us'),
          }),
        });
        const data = await response.json().catch(() => ({}));

        if (data.reply) await sock.sendMessage(from, { text: data.reply }, { quoted: msg });
        if (data.media?.url) await sock.sendMessage(from, { image: { url: data.media.url } }, { quoted: msg });
      } catch (error) {
        console.error('erro ao falar com o app:', error.message);
      }
    }
  });
}

const app = express();
const auth = (req, res, next) => (req.query.key === KARMA_KEY ? next() : res.status(401).json({ error: 'unauthorized' }));

app.get('/state', auth, (req, res) => res.json({ connected, phone, qr }));
app.post('/logout', auth, async (req, res) => {
  try { await sock?.logout(); } catch {}
  connected = false; phone = null; qr = null;
  res.json({ ok: true });
});

app.listen(PORT, () => console.log('Gateway do Karma em http://localhost:' + PORT));

start();
