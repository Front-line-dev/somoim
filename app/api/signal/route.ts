import { env } from 'cloudflare:workers';
import { signalSchema } from '@/db/schema';

export const runtime = 'edge';
const ROOM_PATTERN = /^[a-f0-9]{32}$/;
const MAX_SDP_LENGTH = 128_000;
const TWO_HOURS = 2 * 60 * 60 * 1000;

type SignalBody = {
  room?: string;
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
};

function database() {
  return (env as unknown as { DB: D1Database }).DB;
}

async function initialize() {
  const db = database();
  await db.prepare(signalSchema).run();
  await db.prepare('DELETE FROM signals WHERE created_at < ?').bind(Date.now() - TWO_HOURS).run();
  return db;
}

function validDescription(value: RTCSessionDescriptionInit | undefined, type: 'offer' | 'answer') {
  return value?.type === type && typeof value.sdp === 'string' && value.sdp.length > 0 && value.sdp.length <= MAX_SDP_LENGTH;
}

export async function GET(request: Request) {
  const room = new URL(request.url).searchParams.get('room') ?? '';
  if (!ROOM_PATTERN.test(room)) return Response.json({ error: 'invalid room' }, { status: 400 });
  const db = await initialize();
  const row = await db.prepare('SELECT offer, answer, created_at FROM signals WHERE room = ?').bind(room).first<{ offer: string; answer: string | null; created_at: number }>();
  if (!row || row.created_at < Date.now() - TWO_HOURS) return Response.json({ error: 'room not found' }, { status: 404 });
  return Response.json({ offer: JSON.parse(row.offer), answer: row.answer ? JSON.parse(row.answer) : undefined }, { headers: { 'cache-control': 'no-store' } });
}

export async function POST(request: Request) {
  let body: SignalBody;
  try { body = await request.json() as SignalBody; } catch { return Response.json({ error: 'invalid json' }, { status: 400 }); }
  const room = body.room ?? '';
  if (!ROOM_PATTERN.test(room)) return Response.json({ error: 'invalid room' }, { status: 400 });
  const db = await initialize();
  if (validDescription(body.offer, 'offer')) {
    await db.prepare(`
      INSERT INTO signals (room, offer, answer, created_at) VALUES (?, ?, NULL, ?)
      ON CONFLICT(room) DO UPDATE SET offer = excluded.offer, answer = NULL, created_at = excluded.created_at
    `).bind(room, JSON.stringify(body.offer), Date.now()).run();
    return Response.json({ ok: true }, { status: 201 });
  }
  if (validDescription(body.answer, 'answer')) {
    const result = await db.prepare('UPDATE signals SET answer = ? WHERE room = ? AND created_at >= ?').bind(JSON.stringify(body.answer), room, Date.now() - TWO_HOURS).run();
    if (!result.meta.changes) return Response.json({ error: 'room not found' }, { status: 404 });
    return Response.json({ ok: true });
  }
  return Response.json({ error: 'invalid description' }, { status: 400 });
}
