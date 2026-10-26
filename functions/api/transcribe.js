// POST /api/transcribe?lang=ur  body: raw audio bytes (WAV chunk from the app, or the original file)
// Returns { text, language }
const MAX_BYTES = 12 * 1024 * 1024;
const LANGS = new Set(['ur', 'pa', 'hi', 'en', 'ar', 'sd', 'ps', 'bn']);

// Hints Whisper towards the way family voice notes actually sound.
const PROMPT = 'Assalam o alaikum. Family WhatsApp voice note in Urdu, Punjabi and English mixed together: shaadi, dawat, Friday, Lahore, Ammi, Abbu, Khala, Baji, Bhai, Nani, inshallah.';

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function onRequestPost({ request, env }) {
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > MAX_BYTES) return Response.json({ error: 'This part of the audio is too large.' }, { status: 413 });
  const buf = await request.arrayBuffer();
  if (buf.byteLength === 0) return Response.json({ error: 'No audio was received.' }, { status: 400 });
  if (buf.byteLength > MAX_BYTES) return Response.json({ error: 'This part of the audio is too large.' }, { status: 413 });

  const lang = new URL(request.url).searchParams.get('lang');
  const base = { audio: toBase64(buf) };
  if (lang && LANGS.has(lang)) base.language = lang;

  let out;
  try {
    out = await env.AI.run('@cf/openai/whisper-large-v3-turbo', { ...base, task: 'transcribe', initial_prompt: PROMPT, vad_filter: true });
  } catch (first) {
    try {
      // Retry with only the required fields (in case an optional field is rejected)
      out = await env.AI.run('@cf/openai/whisper-large-v3-turbo', base);
    } catch (second) {
      // Last resort: the original Whisper model takes raw bytes
      out = await env.AI.run('@cf/openai/whisper', { audio: [...new Uint8Array(buf)] });
    }
  }

  let text = String((out && out.text) || '').trim();
  // Whisper sometimes echoes the hint on silent audio — drop it.
  if (text && PROMPT.startsWith(text.slice(0, 40))) text = '';
  return Response.json({ text, language: out?.transcription_info?.language || null });
}
