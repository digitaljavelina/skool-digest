// api.js — Multi-provider AI digest generation

export const PROVIDERS = {
  anthropic:  { name: 'Claude Sonnet 4.6',             model: 'claude-sonnet-4-6' },
  openai:     { name: 'GPT-5.5 (OpenAI)',               model: 'gpt-5.5' },
  gemini:     { name: 'Gemini 2.5 Flash (Google)',      model: 'gemini-2.5-flash' },
  openrouter: { name: 'OpenRouter Claude Haiku Latest', model: '~anthropic/claude-haiku-latest' },
};

export async function generateDigest(posts, watchedMembers, apiKey, provider = 'anthropic') {
  if (!apiKey) throw new Error(`No API key set for ${PROVIDERS[provider]?.name}. Go to Settings.`);
  if (!posts?.length) throw new Error('No posts to analyze.');

  // Trim posts before sending — remove heavy fields, cap body length
  const trimmed = posts.slice(0, 30).map(p => ({
    title:      (p.title    || '').slice(0, 300),
    author:     (p.author   || '').slice(0, 60),
    body:       (p.body     || '').slice(0, 300),
    likes:      p.likes    || 0,
    comments:   p.comments || 0,
    timestamp:  p.timestamp || '',
    category:   p.category  || '',
    isPinned:   p.isPinned  || false,
    postLink:   p.postLink  || '',
    authorLink: p.authorLink || '',
  }));

  const { system, user } = buildPrompt(trimmed, watchedMembers);

  let raw = '';
  if (provider === 'anthropic')    raw = await callAnthropic(system, user, apiKey);
  else if (provider === 'openai')  raw = await callOpenAI(system, user, apiKey);
  else if (provider === 'gemini')  raw = await callGemini(system, user, apiKey);
  else if (provider === 'openrouter') raw = await callOpenRouter(system, user, apiKey);
  else throw new Error('Unknown provider: ' + provider);

  const digest = parseJSON(raw, PROVIDERS[provider]?.name);
  enforceWatchedMembers(digest, watchedMembers);
  return digest;
}

// ── Enforce watched members in post-processing (AI matching is unreliable) ──
// Uses case-insensitive partial match so "Mark" matches "Mark Kashef" and vice versa
function enforceWatchedMembers(digest, watchedMembers) {
  if (!watchedMembers?.length || !digest?.all_posts?.length) return;

  const watched = watchedMembers.map(n => n.toLowerCase().trim());

  const isWatched = (author = '') => {
    const a = author.toLowerCase().trim();
    return watched.some(w => a.includes(w) || w.includes(a));
  };

  // Flag any missed watched members
  digest.all_posts.forEach(post => {
    if (isWatched(post.author)) post.is_watched_member = true;
  });

  // Re-sort: watched members float to the top, preserving their relative order
  const watchedPosts   = digest.all_posts.filter(p => p.is_watched_member);
  const unwatchedPosts = digest.all_posts.filter(p => !p.is_watched_member);
  digest.all_posts = [...watchedPosts, ...unwatchedPosts];

  // Re-number ranks after re-sort
  digest.all_posts.forEach((p, i) => p.rank = i + 1);

  // Update the watched count
  digest.posts_by_watched_members = watchedPosts.length;
}

// ── Prompt ──
function buildPrompt(posts, watchedMembers) {
  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const system = `You are a community analyst for "Early AI-dopters" on Skool — entrepreneurs and builders exploring AI tools.

You will receive a list of posts scraped from the community feed. Produce a daily briefing with ALL posts ranked by importance so the reader misses nothing.

CRITICAL RULES:
- "title" must be COPIED EXACTLY from the post data. Never invent or rewrite titles.
- "likes" and "comments" must be COPIED EXACTLY from the post data numbers. Do not guess.
- Include ALL posts in the ranked list — not just top picks.
- Recency matters: posts timestamped "1h", "2h", "5h" rank higher than "2d", "6d"
- Watched members always rank near the top regardless of engagement
- "why_it_matters": MAX 15 words. What is this post specifically about? No filler, no author mentions, no "this post...". Start with the topic directly. Example: "Step-by-step walkthrough for automating WhatsApp replies using Claude."
- "key_insight": MAX 20 words. The single most actionable takeaway. Be concrete. Example: "Use Claude's tool_use feature to route messages without a backend server."
- "quick_summary": 2 sentences max. Name the 2-3 most interesting specific topics — not vague themes.
- "tags": 2-3 tags max, lowercase, specific (e.g. "claude api", "lead gen", "n8n") not generic ("ai", "tools")

IMPORTANT: Return ONLY a valid JSON object. No markdown. No explanation. Start with { end with }.

Schema:
{
  "digest_date": "${dateStr}",
  "total_posts_analyzed": <number — total posts you received>,
  "quick_summary": "<2 sentences max — specific topics only>",
  "trending_topics": ["<specific topic>", "<specific topic>", "<specific topic>"],
  "posts_by_watched_members": <number>,
  "all_posts": [
    {
      "rank": 1,
      "title": "<EXACT title from post data — do not invent>",
      "author": "<exact author name from post data>",
      "author_link": "<authorLink from post data, or empty string>",
      "post_link": "<postLink from post data, or empty string>",
      "why_it_matters": "<1 sentence about the content value — no author praise, no watched-member mentions>",
      "key_insight": "<single most valuable takeaway>",
      "likes": <exact number from post data>,
      "comments": <exact number from post data>,
      "tags": ["<tag>"],
      "is_watched_member": false,
      "age": "<exact timestamp from post data like 1h or 2d>"
    }
  ]
}`;

  const user = `Today: ${dateStr}
Watched members: ${watchedMembers.length ? watchedMembers.join(', ') : 'none'}
Posts received: ${posts.length}

Posts data:
${JSON.stringify(posts, null, 1)}

Return the complete JSON digest with ALL ${posts.length} posts in all_posts array, ranked by importance.`;

  return { system, user };
}

// ── Robust JSON parser ──
function parseJSON(raw, providerName) {
  if (!raw?.trim()) throw new Error(`${providerName} returned an empty response. Try again.`);

  const attempts = [
    () => JSON.parse(raw),
    () => JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()),
    () => { const m = raw.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); throw new Error(); },
    () => JSON.parse(raw.slice(raw.indexOf('{'))),
  ];

  for (const fn of attempts) {
    try { return fn(); } catch {}
  }

  throw new Error(`${providerName} returned malformed JSON. Try switching to Claude for more reliable output.`);
}

// ── Anthropic Claude ──
async function callAnthropic(system, user, apiKey) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: PROVIDERS.anthropic.model,
      max_tokens: 16000,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e?.error?.message || `Anthropic error ${res.status}`);
  }
  return (await res.json()).content?.[0]?.text || '';
}

// ── OpenAI ──
async function callOpenAI(system, user, apiKey) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: PROVIDERS.openai.model,
      max_tokens: 16000,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e?.error?.message || `OpenAI error ${res.status}`);
  }
  return (await res.json()).choices?.[0]?.message?.content || '';
}

// ── OpenRouter ──
async function callOpenRouter(system, user, apiKey) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'X-Title': 'Skool Daily Digest',
    },
    body: JSON.stringify({
      model: PROVIDERS.openrouter.model,
      max_tokens: 16000,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    const msg = e?.error?.message || `OpenRouter error ${res.status}`;
    if (res.status === 401 || res.status === 403) throw new Error('Invalid OpenRouter API key. Check Settings.');
    if (res.status === 429) throw new Error('OpenRouter rate limit hit. Wait a moment and try again.');
    throw new Error(msg);
  }
  return (await res.json()).choices?.[0]?.message?.content || '';
}

// ── Google Gemini ──
async function callGemini(system, user, apiKey) {
  return callGeminiModel(PROVIDERS.gemini.model, system, user, apiKey);
}

async function callGeminiModel(model, system, user, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        maxOutputTokens: 16384,
        temperature: 0.0,
        responseMimeType: 'application/json',
        // Keep 2.5 Flash output focused on the JSON response.
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });

  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    const msg = e?.error?.message || `Gemini error ${res.status}`;
    if (res.status === 400 && msg.includes('API_KEY')) throw new Error('Invalid Gemini API key. Check Settings.');
    if (res.status === 429) throw new Error('Gemini rate limit hit. Wait a moment and try again.');
    // 404 means model not available in this region/tier — try next
    if (res.status === 404) throw new Error(`Model ${model} not available`);
    throw new Error(msg);
  }

  const data = await res.json();
  const candidate = data.candidates?.[0];
  if (!candidate) throw new Error('Gemini returned no candidates.');
  if (candidate.finishReason === 'SAFETY') throw new Error('Gemini flagged content. Try Claude instead.');

  const text = candidate.content?.parts?.[0]?.text || '';
  if (!text.trim()) throw new Error(`${model} returned empty response.`);
  return text;
}
