// POST /api/summarize  { transcript, output: "both"|"en"|"roman"|"urdu", sender? }
// Returns { title, summary[], roman_urdu, details{when,where,who_brings_what,to_do}, replies[] }
const PRIMARY = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const FALLBACK = '@cf/meta/llama-3.1-8b-instruct-fast';
const MAX_CHARS = 24000;

const LINE_LANG = {
  both: 'English',
  en: 'English',
  roman: 'Roman Urdu (Urdu written in English letters, casual, as people text on WhatsApp)',
  urdu: 'Urdu in Urdu script (اردو)',
};

const schema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    summary: { type: 'array', items: { type: 'string' } },
    roman_urdu: { type: 'string' },
    details: {
      type: 'object',
      properties: {
        when: { type: 'array', items: { type: 'string' } },
        where: { type: 'array', items: { type: 'string' } },
        who_brings_what: { type: 'array', items: { type: 'object', properties: { who: { type: 'string' }, what: { type: 'string' } }, required: ['who', 'what'] } },
        to_do: { type: 'array', items: { type: 'string' } },
      },
      required: ['when', 'where', 'who_brings_what', 'to_do'],
    },
    replies: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'summary', 'roman_urdu', 'details', 'replies'],
};

function systemPrompt(output, sender) {
  const lineLang = LINE_LANG[output] || LINE_LANG.both;
  const who = sender ? `The sender is "${sender}". Address replies to them the way family would (for example "Ji ${sender}, done").` : 'If the transcript shows who is speaking (Khala, Ammi, Baji, Bhai…), address replies to them.';
  return `You summarize family WhatsApp voice notes from Pakistan and North India.
Speakers mix Urdu, Punjabi, Hindi and English, sometimes in one sentence. The transcript may be in Urdu script, Devanagari, Gurmukhi or Roman letters and may contain speech-recognition mistakes. Understand it the way a fluent family member would.

Return JSON only, matching the schema:
- title: 3 to 7 words naming what the note is about, in ${lineLang}.
- summary: at most 3 short lines in ${lineLang}, each under 14 words. Most important first: the news or main ask, then logistics (when, where), then what the listener must do. Plain facts. No greetings, duas or filler. Use fewer lines if the note says less.
- roman_urdu: ${output === 'both' ? 'the same summary as one or two casual Roman Urdu sentences, the way a cousin would text it, for example "Shaadi Friday ko. Sab ek dish laayein. Khala ko station se pick karna hai."' : 'an empty string.'}
- details.when: days, dates and times mentioned, kept short ("Friday", "4 pm").
- details.where: places mentioned.
- details.who_brings_what: who must bring, buy, cook or do what ({"who": "Baji", "what": "biryani"}). Use "Everyone" for the whole family.
- details.to_do: tasks for the person listening, short.
- replies: 3 short replies (2 to 6 words) the listener could send back, in natural Roman Urdu or English, respectful ("Ji", "Theek hai"). The first one agrees or confirms.
${who}
Never invent facts that are not in the transcript. Use empty arrays when nothing applies.`;
}

const clean = (s, max = 220) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const strList = (a, n, max) => (Array.isArray(a) ? a : []).map((x) => clean(x, max)).filter(Boolean).slice(0, n);

function parse(res) {
  let r = res && (res.response ?? res.result ?? res);
  if (typeof r === 'string') {
    const m = r.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Model did not return JSON');
    r = JSON.parse(m[0]);
  }
  if (!r || typeof r !== 'object') throw new Error('Empty model response');
  const d = r.details || {};
  return {
    title: clean(r.title, 80),
    summary: strList(r.summary, 3, 200),
    roman_urdu: clean(r.roman_urdu, 400),
    details: {
      when: strList(d.when, 6, 60),
      where: strList(d.where, 6, 80),
      who_brings_what: (Array.isArray(d.who_brings_what) ? d.who_brings_what : [])
        .map((x) => ({ who: clean(x && x.who, 40), what: clean(x && x.what, 80) }))
        .filter((x) => x.what).slice(0, 8),
      to_do: strList(d.to_do, 5, 120),
    },
    replies: strList(r.replies, 3, 60),
  };
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'Send JSON with a transcript.' }, { status: 400 }); }
  const transcript = clean(body && body.transcript, MAX_CHARS);
  if (transcript.length < 3) return Response.json({ error: 'The transcript is empty.' }, { status: 400 });
  const output = ['both', 'en', 'roman', 'urdu'].includes(body.output) ? body.output : 'both';
  const sender = clean(body.sender, 40);

  const messages = [
    { role: 'system', content: systemPrompt(output, sender) },
    { role: 'user', content: `Transcript of the voice note:\n"""\n${transcript}\n"""` },
  ];
  const opts = { messages, response_format: { type: 'json_schema', json_schema: schema }, max_tokens: 900, temperature: 0.2 };

  const primary = env.SUMMARY_MODEL || PRIMARY;
  let result;
  try {
    result = parse(await env.AI.run(primary, opts));
  } catch (e) {
    console.warn('primary model failed, using fallback:', String(e && e.message));
    result = parse(await env.AI.run(FALLBACK, opts));
  }
  if (!result.summary.length) result.summary = [transcript.slice(0, 160) + (transcript.length > 160 ? '…' : '')];
  if (output !== 'both') result.roman_urdu = '';
  return Response.json(result);
}
