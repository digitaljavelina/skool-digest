// storage.js — Chrome local storage helpers

export const Storage = {
  async get(keys) {
    return new Promise(resolve => chrome.storage.local.get(keys, resolve));
  },

  async set(data) {
    return new Promise(resolve => chrome.storage.local.set(data, resolve));
  },

  // ── Community key/name helpers ──
  // Extracts slug from URL: https://www.skool.com/earlyaidopters?s=newest → "earlyaidopters"
  communityKey(url) {
    try {
      const slug = new URL(url).pathname.replace(/\//g, '').trim();
      return slug || 'default';
    } catch {
      return 'default';
    }
  },

  communityName(url) {
    try {
      const slug = new URL(url).pathname.replace(/\//g, '').trim();
      return slug || 'Unknown Community';
    } catch {
      return 'Unknown Community';
    }
  },

  // ── Settings ──
  async getSettings() {
    const data = await this.get([
      'provider', 'anthropicKey', 'openaiKey', 'geminiKey', 'openrouterKey', 'watchedMembers',
    ]);
    return {
      provider:       data.provider       || 'anthropic',
      anthropicKey:   data.anthropicKey   || '',
      openaiKey:      data.openaiKey      || '',
      geminiKey:      data.geminiKey      || '',
      openrouterKey:  data.openrouterKey  || '',
      watchedMembers: data.watchedMembers || [],
    };
  },

  async saveSettings(s) {
    await this.set({
      provider:       s.provider,
      anthropicKey:   s.anthropicKey,
      openaiKey:      s.openaiKey,
      geminiKey:      s.geminiKey,
      openrouterKey:  s.openrouterKey,
      watchedMembers: s.watchedMembers,
    });
  },

  // ── Digest cache ──
  // Each community gets its own cache slot keyed by slug.
  // A "digestRegistry" array tracks all known slugs so we can enumerate them.

  async saveDigest(digest, pageUrl) {
    const key  = this.communityKey(pageUrl);
    const name = this.communityName(pageUrl);

    digest._communityUrl  = pageUrl;
    digest._communityName = name;
    digest._savedAt       = Date.now();

    // Update registry of known community keys
    const { digestRegistry = [] } = await this.get(['digestRegistry']);
    if (!digestRegistry.includes(key)) digestRegistry.push(key);

    await this.set({
      [`digest_${key}`]:     digest,
      [`digestDate_${key}`]: new Date().toDateString(),
      digestRegistry,
    });
  },

  async getCachedDigest(pageUrl) {
    const key  = this.communityKey(pageUrl);
    const data = await this.get([`digest_${key}`, `digestDate_${key}`]);
    const today = new Date().toDateString();
    if (data[`digestDate_${key}`] === today && data[`digest_${key}`]) {
      return data[`digest_${key}`];
    }
    return null;
  },

  // Returns all cached digests generated today, sorted newest first
  async getAllTodaysDigests() {
    const { digestRegistry = [] } = await this.get(['digestRegistry']);
    if (!digestRegistry.length) return [];

    const keys = digestRegistry.flatMap(k => [`digest_${k}`, `digestDate_${k}`]);
    const data = await this.get(keys);
    const today = new Date().toDateString();

    const results = [];
    for (const k of digestRegistry) {
      if (data[`digestDate_${k}`] === today && data[`digest_${k}`]) {
        results.push(data[`digest_${k}`]);
      }
    }

    // Sort by most recently saved
    results.sort((a, b) => (b._savedAt || 0) - (a._savedAt || 0));
    return results;
  },

  async clearCachedDigest(pageUrl) {
    const key = this.communityKey(pageUrl);
    await this.set({ [`digest_${key}`]: null, [`digestDate_${key}`]: null });
  },

  getActiveKey(settings) {
    if (settings.provider === 'openai')  return settings.openaiKey;
    if (settings.provider === 'gemini')  return settings.geminiKey;
    if (settings.provider === 'openrouter') return settings.openrouterKey;
    return settings.anthropicKey;
  },
};
