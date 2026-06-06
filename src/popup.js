// popup.js — Skool Daily Digest UI v4

import { Storage } from './storage.js';
import { generateDigest, PROVIDERS } from './api.js';

let settings = {};
let isRunning = false;
let currentDigest = null;
let isDark = true;

// ── Boot ──
document.addEventListener('DOMContentLoaded', async () => {
  settings = await Storage.getSettings();

  // Show version from manifest
  const v = chrome.runtime.getManifest().version;
  const vEl = document.getElementById('headerVersion');
  if (vEl) vEl.textContent = `v${v}`;

  // Load theme preference
  const themeData = await Storage.get(['theme']);
  isDark = themeData.theme !== 'light';
  applyTheme();

  setupTabs();
  setupSettings();
  await initDigest();
});

// ── Theme ──
function applyTheme() {
  document.body.classList.toggle('light-mode', !isDark);
  const btn = document.getElementById('btnTheme');
  if (btn) btn.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
  if (btn) btn.innerHTML = isDark ? sunIcon() : moonIcon();
}

function sunIcon() {
  return `<svg viewBox="0 0 14 14" fill="none" width="13" height="13"><circle cx="7" cy="7" r="2.5" stroke="currentColor" stroke-width="1.3"/><path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.93 2.93l1.06 1.06M10.01 10.01l1.06 1.06M2.93 11.07l1.06-1.06M10.01 3.99l1.06-1.06" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`;
}

function moonIcon() {
  return `<svg viewBox="0 0 14 14" fill="none" width="13" height="13"><path d="M11.5 8.5A5 5 0 0 1 5.5 2.5a5 5 0 1 0 6 6z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
}

async function toggleTheme() {
  isDark = !isDark;
  await Storage.set({ theme: isDark ? 'dark' : 'light' });
  applyTheme();
}

// ── Tab switching ──
function setupTabs() {
  document.querySelectorAll('.tab').forEach(t =>
    t.addEventListener('click', () => switchTab(t.dataset.tab))
  );
  document.getElementById('btnSettings').addEventListener('click', () => switchTab('settings'));
  document.getElementById('btnRefresh').addEventListener('click', clearCache);
  document.getElementById('btnTheme').addEventListener('click', toggleTheme);
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === name)
  );
  document.getElementById('panelDigest').style.display   = name === 'digest'   ? 'block' : 'none';
  document.getElementById('panelSettings').style.display = name === 'settings' ? 'block' : 'none';
}

// ── Digest panel init ──
async function initDigest() {
  const key = Storage.getActiveKey(settings);
  if (!key) { showNoKey(); return; }

  // 1. If the active tab is a Skool tab, show that community's cache
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab?.url?.includes('skool.com')) {
    const cached = await Storage.getCachedDigest(activeTab.url);
    if (cached) { currentDigest = cached; renderDigest(cached, true); return; }
    showReady(); return;
  }

  // 2. Not on Skool — find most recently cached digest from any community today
  const allDigests = await Storage.getAllTodaysDigests();
  if (allDigests.length) {
    currentDigest = allDigests[0];
    renderDigest(allDigests[0], true);
    return;
  }

  showReady();
}

function showNoKey() {
  document.getElementById('digestBody').innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">🔑</div>
      <div class="empty-title">API Key Required</div>
      <div class="empty-text">Add an API key in the Settings tab to get started.</div>
    </div>`;
}

function showReady() {
  const providerName = PROVIDERS[settings.provider]?.name || 'AI';
  document.getElementById('digestBody').innerHTML = `
    <div class="run-wrap">
      <button class="run-btn" id="btnRun">
        <svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/><path d="M8 5v3l2 2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
        Generate Feed Digest
      </button>
      <div class="status-bar">
        <span class="dot"></span>
        <span>Using <strong>${esc(providerName)}</strong> · Sort feed by New / Top / Unread first, then Generate</span>
      </div>
    </div>`;
  document.getElementById('btnRun').addEventListener('click', runDigest);
}

async function clearCache() {
  // Clear the cache for whichever community is currently shown
  const pageUrl = currentDigest?._communityUrl || '';
  if (pageUrl) await Storage.clearCachedDigest(pageUrl);
  currentDigest = null;
  showReady();
  switchTab('digest');
}

// ── Run digest ──
async function runDigest() {
  if (isRunning) return;
  isRunning = true;

  // Use active tab if it's Skool, otherwise find any open Skool tab
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.includes('skool.com')) {
    const [skoolTab] = await chrome.tabs.query({ url: 'https://www.skool.com/*' });
    if (skoolTab) {
      tab = skoolTab;
      await chrome.tabs.update(skoolTab.id, { active: true });
    } else {
      document.getElementById('digestBody').innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">👆</div>
          <div class="empty-title">Open Skool First</div>
          <div class="empty-text">No Skool tab found. Open your community feed, sort it how you want (New / Top / Unread), then hit Generate.</div>
          <button class="run-btn" style="margin-top:12px" id="btnOpenSkool">Open Skool</button>
        </div>`;
      document.getElementById('btnOpenSkool')?.addEventListener('click', () =>
        chrome.tabs.create({ url: 'https://www.skool.com' })
      );
      isRunning = false;
      return;
    }
  }

  const providerName = PROVIDERS[settings.provider]?.name || 'AI';
  setStatus('Loading feed posts…');

  try {
    // content.js is already injected via manifest content_scripts — no need to re-inject
    const result = await chrome.tabs.sendMessage(tab.id, { action: 'scrapePosts' });
    const posts   = result?.posts   || [];
    const debug   = result?.debug   || [];
    const pageUrl = result?.pageUrl || tab.url || '';

    if (posts.length === 0) {
      document.getElementById('digestBody').innerHTML = `
        <div class="run-wrap">
          <div class="empty-state" style="padding:20px 0">
            <div class="empty-icon">😶</div>
            <div class="empty-title">No posts found</div>
            <div class="empty-text" style="margin-bottom:14px">
              Try these before retrying:<br><br>
              1. Make sure the Skool feed is fully loaded<br>
              2. Scroll down the feed a little, then come back<br>
              3. Try sorting by <strong>New</strong> or <strong>Top</strong>
            </div>
          </div>
          <button class="run-btn" id="btnRun">Try Again</button>
        </div>`;
      document.getElementById('btnRun')?.addEventListener('click', runDigest);
      isRunning = false;
      return;
    }

    setStatus(`Found ${posts.length} posts · Sending to ${providerName}…`, true);

    const apiKey = Storage.getActiveKey(settings);
    const digest = await generateDigest(posts, settings.watchedMembers, apiKey, settings.provider);

    currentDigest = digest;
    await Storage.saveDigest(digest, pageUrl);
    clearStatusTimer();
    renderDigest(digest, false);

  } catch (err) {
    clearStatusTimer();
    document.getElementById('digestBody').innerHTML = `
      <div class="run-wrap">
        <button class="run-btn" id="btnRun">Try Again</button>
        <div class="error-box">${esc(err.message)}</div>
      </div>`;
    document.getElementById('btnRun')?.addEventListener('click', runDigest);
  } finally {
    isRunning = false;
  }
}

let _statusTimer = null;
function setStatus(msg, showElapsed = false) {
  if (_statusTimer) { clearInterval(_statusTimer); _statusTimer = null; }
  const id = 'statusElapsed';
  document.getElementById('digestBody').innerHTML = `
    <div class="run-wrap">
      <div class="status-bar">
        <span class="dot pulse"></span>
        <span>${esc(msg)}${showElapsed ? ` <span id="${id}" style="color:var(--muted)"></span>` : ''}</span>
      </div>
    </div>`;
  if (showElapsed) {
    let secs = 0;
    _statusTimer = setInterval(() => {
      const el = document.getElementById(id);
      if (el) el.textContent = `(${++secs}s…)`;
    }, 1000);
  }
}

function clearStatusTimer() {
  if (_statusTimer) { clearInterval(_statusTimer); _statusTimer = null; }
}

// ── Render digest ──
function renderDigest(digest, fromCache) {
  const posts = digest.all_posts || digest.top_posts || [];
  const communityName = digest._communityName || '';
  const communityUrl  = digest._communityUrl  || '';

  // Update header community name dynamically
  const headerSub = document.getElementById('headerCommunity');
  if (headerSub && communityName) headerSub.textContent = communityName;

  const trending = (digest.trending_topics || [])
    .map(t => `<span class="tag">${esc(t)}</span>`).join('');

  const postsHtml = posts.map(post => {
    const authorHtml = post.author_link
      ? `<a href="${esc(post.author_link)}" target="_blank">${esc(post.author)}</a>`
      : esc(post.author || 'Unknown');

    const tags = (post.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('');
    const readLink = post.post_link
      ? `<a href="${esc(post.post_link)}" target="_blank" class="read-link">Read ↗</a>`
      : '';

    const likes    = post.likes    ?? post.engagement?.likes    ?? 0;
    const comments = post.comments ?? post.engagement?.comments ?? 0;

    return `
      <div class="post-card ${post.is_watched_member ? 'watched' : ''}">
        <div class="post-meta-top">
          <span class="rank">#${post.rank}</span>
          ${post.age ? `<span class="age-badge">${esc(post.age)}</span>` : ''}
          ${post.is_watched_member ? `<span class="watched-badge">★ Watched</span>` : ''}
        </div>
        <div class="post-title">${esc(post.title)}</div>
        <div class="post-why">${esc(post.why_it_matters)}</div>
        ${post.key_insight ? `<div class="post-insight">${esc(post.key_insight)}</div>` : ''}
        <div class="post-footer">
          <span class="post-author">by ${authorHtml}</span>
          <span class="engagement">
            <span class="eng-pill">
              <svg viewBox="0 0 14 14" fill="none" width="10" height="10"><path d="M2 9C2 9 1 8 1 6C1 4 2.5 2.5 4.5 2.5C5.5 2.5 6.3 3 7 4C7.7 3 8.5 2.5 9.5 2.5C11.5 2.5 13 4 13 6C13 8 7 12.5 7 12.5C7 12.5 2 9 2 9Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>
              ${likes}
            </span>
            <span class="eng-pill">
              <svg viewBox="0 0 14 14" fill="none" width="10" height="10"><path d="M2 2h10v8H8.5L7 12l-1.5-2H2V2z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>
              ${comments}
            </span>
          </span>
          ${readLink}
        </div>
        ${tags ? `<div class="tags" style="margin-top:8px">${tags}</div>` : ''}
      </div>`;
  }).join('');

  const watchedCount = digest.posts_by_watched_members || 0;
  const totalScanned = digest.total_posts_analyzed || posts.length;
  const metaParts = [`${totalScanned} posts`];
  if (watchedCount) metaParts.push(`${watchedCount} watched`);
  if (communityName) metaParts.push(communityName);

  document.getElementById('digestBody').innerHTML = `
    ${fromCache ? `<div class="cache-notice">Showing cached digest · <a id="linkFresh" href="#">Run fresh</a></div>` : ''}
    <div class="digest-header">
      ${communityName ? `<div class="digest-community"><a href="${esc(communityUrl)}" target="_blank">${esc(communityName)}</a></div>` : ''}
      <div class="digest-date">${esc(digest.digest_date || '')}</div>
      <div class="summary">${esc(digest.quick_summary || '')}</div>
      <div class="digest-meta">${metaParts.join(' · ')}</div>
    </div>

    <div class="export-row">
      <button class="export-btn" id="btnOpenHtml">
        <svg viewBox="0 0 14 14" fill="none" width="11" height="11"><path d="M3 2l-2 5 2 5M11 2l2 5-2 5M6 11.5l2-9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
        Open HTML
      </button>
      <button class="export-btn" id="btnCopyMd">
        <svg viewBox="0 0 14 14" fill="none" width="11" height="11"><rect x="4" y="4" width="8" height="9" rx="1" stroke="currentColor" stroke-width="1.2"/><path d="M2 10V2h8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
        Copy Markdown
      </button>
    </div>

    ${trending ? `<div class="section-divider">Trending</div><div class="tags">${trending}</div>` : ''}
    <div class="section-divider">All posts · ranked by importance</div>
    ${postsHtml || '<div class="empty-text">No posts to show.</div>'}
  `;

  if (fromCache) {
    document.getElementById('linkFresh')?.addEventListener('click', e => { e.preventDefault(); clearCache(); });
  }
  document.getElementById('btnOpenHtml')?.addEventListener('click', () => openInTab(digest, 'html'));
  document.getElementById('btnCopyMd')?.addEventListener('click',   () => copyToClipboard(digest));
}

// ── Open in new browser tab (no save needed) ──
function openInTab(digest, format) {
  const content = format === 'md' ? buildMarkdown(digest) : buildHTML(digest);
  const mime = format === 'md' ? 'text/plain' : 'text/html';
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  chrome.tabs.create({ url }, () => {
    // Revoke after a short delay to allow the tab to load the blob
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });
}

// ── Copy MD to clipboard ──
function copyToClipboard(digest) {
  const md = buildMarkdown(digest);
  navigator.clipboard.writeText(md).then(() => flashBtn('btnCopyMd', '✓ Copied!'));
}

// ── Build Markdown ──
function buildMarkdown(digest) {
  const posts = digest.all_posts || digest.top_posts || [];
  const community = digest._communityName ? ` · ${digest._communityName}` : '';
  let md = `# Skool Daily Digest${community} — ${digest.digest_date || ''}\n\n`;
  md += `${digest.quick_summary || ''}\n\n`;
  if (digest.trending_topics?.length) {
    md += `**Trending:** ${digest.trending_topics.join(' · ')}\n\n`;
  }
  md += `---\n\n`;
  posts.forEach(post => {
    const likes    = post.likes    ?? post.engagement?.likes    ?? 0;
    const comments = post.comments ?? post.engagement?.comments ?? 0;
    md += `## #${post.rank} — ${post.title}\n`;
    md += `**By:** ${post.author || 'Unknown'}`;
    if (post.author_link) md += ` ([profile](${post.author_link}))`;
    md += `  \n`;
    md += `**Age:** ${post.age || '—'}  👍 **${likes}**  💬 **${comments}**\n\n`;
    md += `${post.why_it_matters || ''}\n\n`;
    if (post.key_insight) md += `> ${post.key_insight}\n\n`;
    if (post.tags?.length) md += `*Tags: ${post.tags.join(', ')}*\n\n`;
    if (post.post_link) md += `[Read post →](${post.post_link})\n\n`;
    md += `---\n\n`;
  });
  return md;
}

// ── Build styled HTML ──
function buildHTML(digest) {
  const posts = digest.all_posts || digest.top_posts || [];
  const dark = isDark;

  const bg         = dark ? '#111110' : '#faf9f6';
  const surface    = dark ? '#1c1c1a' : '#ffffff';
  const border     = dark ? '#2e2e2b' : '#e8e6e0';
  const text       = dark ? '#eeedea' : '#1c1b18';
  const muted      = dark ? '#90908a' : '#8a8880';
  const accentText = dark ? '#c8f561' : '#4a6b10';

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${digest._communityName ? esc(digest._communityName) + ' — ' : ''}Skool Digest — ${digest.digest_date || ''}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { font-size: 17px; }
  body { background: ${bg}; color: ${text}; font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; max-width: 860px; margin: 0 auto; padding: 56px 32px; line-height: 1.65; -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
  .community { font-size: .82rem; font-weight: 700; color: ${accentText}; letter-spacing: .04em; text-transform: uppercase; margin-bottom: 6px; }
  .community a { color: inherit; text-decoration: none; }
  h1 { font-size: 2rem; font-weight: 700; letter-spacing: -.02em; margin-bottom: 8px; color: ${text}; line-height: 1.16; text-wrap: balance; }
  .date { font-size: .95rem; color: ${muted}; margin-bottom: 18px; }
  .summary { font-size: 1.1rem; color: ${text}; opacity: .82; margin-bottom: 12px; line-height: 1.75; max-width: 66ch; text-wrap: pretty; }
  .meta { font-size: .95rem; color: ${muted}; margin-bottom: 38px; }
  .trending { font-size: .95rem; color: ${muted}; margin-bottom: 38px; line-height: 1.65; }
  .trending strong { color: ${text}; }
  .section-label { font-size: .9rem; font-weight: 600; color: ${muted}; margin: 32px 0 18px; padding-bottom: 12px; border-bottom: 1px solid ${border}; }
  .post { background: ${surface}; border: 1px solid ${border}; border-radius: 12px; padding: 28px 30px; margin-bottom: 18px; }
  .post-header { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; font-size: .86rem; color: ${muted}; }
  .rank { font-weight: 600; }
  .age { background: ${border}; padding: 2px 9px; border-radius: 5px; }
  h2 { font-size: 1.25rem; font-weight: 700; margin-bottom: 10px; line-height: 1.35; color: ${text}; letter-spacing: -.01em; text-wrap: pretty; }
  .why { font-size: 1rem; color: ${muted}; margin-bottom: 16px; line-height: 1.7; text-wrap: pretty; }
  blockquote { border-left: 3px solid ${accentText}; padding-left: 16px; font-style: italic; color: ${text}; opacity: .78; font-size: .98rem; margin-bottom: 18px; line-height: 1.7; }
  .post-footer { display: flex; align-items: center; gap: 16px; font-size: .9rem; color: ${muted}; flex-wrap: wrap; }
  .author a { color: ${text}; text-decoration: none; opacity: .7; }
  .read-link { color: ${accentText}; text-decoration: none; font-weight: 600; border: 1px solid ${border}; padding: 5px 14px; border-radius: 5px; margin-left: auto; }
  .tags { margin-top: 16px; display: flex; flex-wrap: wrap; gap: 7px; }
  .tag { font-size: .86rem; padding: 4px 10px; background: ${border}; border-radius: 5px; color: ${muted}; }
  @media (max-width: 720px) {
    html { font-size: 16px; }
    body { padding: 32px 18px; }
    .post { padding: 22px 20px; }
    .read-link { margin-left: 0; }
  }
</style>
</head>
<body>
${digest._communityName ? `<div class="community"><a href="${digest._communityUrl || '#'}">${digest._communityName}</a></div>` : ''}
<h1>Daily Digest</h1>
<div class="date">${digest.digest_date || ''}</div>
<p class="summary">${digest.quick_summary || ''}</p>
<div class="meta">${digest.total_posts_analyzed || posts.length} posts${digest.posts_by_watched_members ? ` · ${digest.posts_by_watched_members} watched` : ''}</div>
`;

  if (digest.trending_topics?.length) {
    html += `<p class="trending"><strong>Trending:</strong> ${digest.trending_topics.join(' &nbsp;·&nbsp; ')}</p>\n`;
  }

  html += `<div class="section-label">All posts · ranked by importance</div>\n`;

  posts.forEach(post => {
    const likes    = post.likes    ?? post.engagement?.likes    ?? 0;
    const comments = post.comments ?? post.engagement?.comments ?? 0;
    const safeAuthorLink = safeUrl(post.author_link);
    const safePostLink   = safeUrl(post.post_link);
    const authorHtml = safeAuthorLink
      ? `<a href="${safeAuthorLink}">${esc(post.author || 'Unknown')}</a>`
      : esc(post.author || 'Unknown');
    const tags = (post.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('');

    html += `<div class="post">
  <div class="post-header">
    <span class="rank">#${esc(String(post.rank))}</span>
    ${post.age ? `<span class="age">${esc(post.age)}</span>` : ''}
    ${post.is_watched_member ? `<span class="age" style="color:${accentText}">★ Watched</span>` : ''}
  </div>
  <h2>${esc(post.title)}</h2>
  <p class="why">${esc(post.why_it_matters || '')}</p>
  ${post.key_insight ? `<blockquote>${esc(post.key_insight)}</blockquote>` : ''}
  <div class="post-footer">
    <span class="author">by ${authorHtml}</span>
    <span>👍 ${likes} &nbsp; 💬 ${comments}</span>
    ${safePostLink ? `<a href="${safePostLink}" class="read-link" target="_blank" rel="noopener noreferrer">Read →</a>` : ''}
  </div>
  ${tags ? `<div class="tags">${tags}</div>` : ''}
</div>\n`;
  });

  html += `</body>\n</html>`;
  return html;
}

function flashBtn(id, msg) {
  const btn = document.getElementById(id);
  if (!btn) return;
  const orig = btn.innerHTML;
  btn.textContent = msg;
  btn.style.color = 'var(--accent)';
  setTimeout(() => { btn.innerHTML = orig; btn.style.color = ''; }, 2000);
}

// ── Settings ──
function setupSettings() {
  document.querySelectorAll('.provider-tab').forEach(btn => {
    btn.addEventListener('click', () => { _pendingProvider = btn.dataset.provider; updateProviderUI(); });
  });
  document.getElementById('btnAddMember').addEventListener('click', addMember);
  document.getElementById('inputMember').addEventListener('keydown', e => { if (e.key === 'Enter') addMember(); });
  document.getElementById('btnSave').addEventListener('click', saveSettings);
  updateProviderUI();
  document.getElementById('inputAnthropic').value = settings.anthropicKey || '';
  document.getElementById('inputOpenAI').value    = settings.openaiKey    || '';
  document.getElementById('inputGemini').value    = settings.geminiKey    || '';
  document.getElementById('inputOpenRouter').value = settings.openrouterKey || '';
  renderMembers();
}

let _pendingProvider = null;

function updateProviderUI() {
  const p = _pendingProvider || settings.provider || 'anthropic';
  document.querySelectorAll('.provider-tab').forEach(b => b.classList.toggle('active', b.dataset.provider === p));
  document.querySelectorAll('.key-group').forEach(g => g.style.display = g.dataset.provider === p ? 'block' : 'none');
}

function renderMembers() {
  const list = document.getElementById('memberList');
  if (!settings.watchedMembers.length) {
    list.innerHTML = '<div class="empty-members">No watched members yet.</div>';
    return;
  }
  list.innerHTML = settings.watchedMembers.map((name, i) => `
    <div class="member-item">
      <span>${esc(name)}</span>
      <button class="btn-remove" data-i="${i}">✕</button>
    </div>`).join('');
  list.querySelectorAll('.btn-remove').forEach(btn =>
    btn.addEventListener('click', () => { settings.watchedMembers.splice(+btn.dataset.i, 1); renderMembers(); })
  );
}

function addMember() {
  const input = document.getElementById('inputMember');
  const name = input.value.trim();
  if (name && !settings.watchedMembers.includes(name)) { settings.watchedMembers.push(name); renderMembers(); }
  input.value = ''; input.focus();
}

async function saveSettings() {
  if (_pendingProvider) { settings.provider = _pendingProvider; _pendingProvider = null; }

  const anthropicKey = document.getElementById('inputAnthropic').value.trim();
  const openaiKey    = document.getElementById('inputOpenAI').value.trim();
  const geminiKey    = document.getElementById('inputGemini').value.trim();
  const openrouterKey = document.getElementById('inputOpenRouter').value.trim();

  // Validate key formats — warn but still save
  const warnings = [];
  if (anthropicKey && !anthropicKey.startsWith('sk-ant-'))
    warnings.push('Claude key should start with sk-ant-');
  if (openaiKey && !openaiKey.startsWith('sk-'))
    warnings.push('OpenAI key should start with sk-');
  if (geminiKey && !geminiKey.startsWith('AIza'))
    warnings.push('Gemini key should start with AIza');
  if (openrouterKey && !openrouterKey.startsWith('sk-or-'))
    warnings.push('OpenRouter key should start with sk-or-');
  if (anthropicKey.length > 200 || openaiKey.length > 200 || geminiKey.length > 200 || openrouterKey.length > 200)
    warnings.push('API key looks too long — double check it');

  // Enforce max length before storing
  settings.anthropicKey = anthropicKey.slice(0, 200);
  settings.openaiKey    = openaiKey.slice(0, 200);
  settings.geminiKey    = geminiKey.slice(0, 200);
  settings.openrouterKey = openrouterKey.slice(0, 200);

  await Storage.saveSettings(settings);

  const confirmEl = document.getElementById('saveConfirm');
  if (warnings.length) {
    confirmEl.textContent = '⚠ Saved — ' + warnings.join(' · ');
    confirmEl.style.color = 'var(--gold)';
  } else {
    confirmEl.textContent = '✓ Saved';
    confirmEl.style.color = '';
  }
  confirmEl.style.opacity = '1';
  setTimeout(() => { confirmEl.style.opacity = '0'; confirmEl.style.color = ''; }, 3000);
}

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// Only allow https:// URLs — blocks javascript: and data: URLs
function safeUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? esc(url) : '';
  } catch {
    return '';
  }
}
