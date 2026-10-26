export const onRequestGet = ({ env }) =>
  Response.json({ ok: true, ai: !!env.AI, time: new Date().toISOString() });
