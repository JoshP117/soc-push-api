import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as admin from 'firebase-admin';

const APP_KEY = process.env.APP_KEY!;
const FCM_SERVER_KEY = process.env.FCM_SERVER_KEY!;
const GOOGLE_CREDS = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON!;

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(GOOGLE_CREDS) as any) });
}
const db = admin.firestore();

async function sendToToken(token: string, title: string, body: string) {
  const res = await fetch('https://fcm.googleapis.com/fcm/send', {
    method: 'POST',
    headers: {
      'Content-Type':'application/json',
      'Authorization': `key=${FCM_SERVER_KEY}`
    },
    body: JSON.stringify({
      to: token,
      notification: { title, body },
      data: {}
    })
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, json };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') return res.status(405).end();
    if (req.headers['x-app-key'] !== APP_KEY) return res.status(401).json({ ok:false, msg:'bad key' });

    const { uid, title, body } = req.body as { uid: string; title: string; body?: string };
    if (!uid || !title) return res.status(400).json({ ok:false });

    const snap = await db.doc(`users/${uid}`).get();
    const tokensObj = (snap.data() || {}).fcmTokens || {};
    const tokens = Object.keys(tokensObj);

    if (!tokens.length) return res.status(200).json({ ok:true, delivered:0, total:0 });

    let delivered = 0;
    for (const t of tokens) {
      const r = await sendToToken(t, title, body || '');
      if (r.ok) delivered++;
      // Si quieres, aquí puedes limpiar tokens inválidos examinando r.json
    }

    return res.status(200).json({ ok:true, delivered, total: tokens.length });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok:false });
  }
}
