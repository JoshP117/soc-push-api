// /api/push.ts (Vercel)
// Enviar notificaciones FCM HTTP v1 usando Service Account JSON (env GOOGLE_APPLICATION_CREDENTIALS_JSON)

import type { VercelRequest, VercelResponse } from 'vercel';
import { google } from 'googleapis';

const APP_KEY = process.env.APP_KEY || 'soc-metropoli-2025';
const saJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON
  ? JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)
  : null;

// cache simple del access token
let cachedToken: { token: string; exp: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (!saJson) throw new Error('Falta GOOGLE_APPLICATION_CREDENTIALS_JSON');

  const jwtClient = new google.auth.JWT({
    email: saJson.client_email,
    key: saJson.private_key,
    scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
  });

  // reusar token si no ha caducado
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 60 > now) return cachedToken.token;

  const { token, res } = await jwtClient.authorize();
  if (!token) throw new Error('No se pudo obtener accessToken');
  const exp = Number(res?.data?.exp) || now + 3000;
  cachedToken = { token, exp };
  return token;
}

async function sendToToken(projectId: string, token: string, title: string, body: string, data: any = {}) {
  const accessToken = await getAccessToken();

  const resp = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        token,
        notification: { title, body },
        data,
      },
      validate_only: false
    }),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`FCM error: ${resp.status} ${txt}`);
  }
  return resp.json();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
    if (req.headers['x-app-key'] !== APP_KEY) return res.status(401).json({ ok: false, error: 'Bad app key' });
    if (!saJson?.project_id) return res.status(500).json({ ok: false, error: 'ServiceAccount sin project_id' });

    const { userIds, tokens, title, body, data } = req.body || {};
    if ((!Array.isArray(tokens) || tokens.length === 0) && (!Array.isArray(userIds) || userIds.length === 0)) {
      return res.status(400).json({ ok:false, error:'Debes enviar tokens[] o userIds[]' });
    }

    // Si nos mandan tokens directos, se usan tal cual.
    // Si nos mandan userIds, aquí deberías resolver sus tokens desde Firestore.
    // Para simplificar, asumo que ya te llegan tokens[] (puedes extenderlo con Firestore si quieres).
    const allTokens: string[] = Array.isArray(tokens) ? tokens : [];

    let delivered = 0;
    for (const tk of allTokens) {
      try {
        await sendToToken(saJson.project_id, tk, title || 'SOC Metrópoli', body || '', data || {});
        delivered++;
      } catch (e) {
        console.error('Error enviando a token', tk, e);
      }
    }

    return res.status(200).json({ ok:true, projectId: saJson.project_id, delivered, total: allTokens.length });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ ok:false, error:e.message || 'Internal error' });
  }
}
