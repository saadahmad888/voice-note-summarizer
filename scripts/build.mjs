// Build script — no dependencies, runs on Cloudflare Pages and GitHub Actions.
// Reads site.config.json, replaces {{TOKENS}} in src/, and writes:
//   dist/  -> the website (landing page + online app) for Cloudflare Pages
//   www/   -> the app only, bundled inside the Android APK by Capacitor
import { readFile, writeFile, mkdir, readdir, rm, copyFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(await readFile(join(root, 'site.config.json'), 'utf8'));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

const siteUrl = String(cfg.siteUrl || '').replace(/\/+$/, '');
const owner = cfg.owner || {};
const repo = String(cfg.githubRepo || '').replace(/^https?:\/\/github\.com\//, '');
const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const today = new Date().toISOString().slice(0, 10);

// Owner links: only the ones you filled in are shown.
const linkDefs = [
  ['website', 'Website', 'globe'],
  ['github', 'GitHub', 'github'],
  ['linkedin', 'LinkedIn', 'linkedin'],
  ['twitter', 'X / Twitter', 'x'],
  ['instagram', 'Instagram', 'instagram'],
];
const icons = {
  globe: '<path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0c2.5 2.4 3.8 5.4 3.8 9s-1.3 6.6-3.8 9m0-18C9.5 5.4 8.2 8.4 8.2 12s1.3 6.6 3.8 9M3.5 9h17M3.5 15h17"/>',
  github: '<path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/>',
  linkedin: '<path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6ZM2 9h4v12H2zM4 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z"/>',
  x: '<path d="M4 4l16 16M20 4L4 20"/>',
  instagram: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".6"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z"/>',
};
const svg = (name) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;

let ownerLinks = '';
if (owner.email) ownerLinks += `<li><a href="mailto:${esc(owner.email)}" rel="me">${svg('mail')}<span>${esc(owner.email)}</span></a></li>`;
if (owner.phone) ownerLinks += `<li><a href="tel:${esc(owner.phone.replace(/\s+/g, ''))}">${svg('phone')}<span>${esc(owner.phone)}</span></a></li>`;
for (const [key, label, icon] of linkDefs) {
  if (owner[key]) ownerLinks += `<li><a href="${esc(owner[key])}" target="_blank" rel="me noopener">${svg(icon)}<span>${label}</span></a></li>`;
}
const sameAs = linkDefs.map(([k]) => owner[k]).filter(Boolean);
const initials = String(owner.name || 'VN').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
const ownerAvatar = owner.photo
  ? `<img class="owner__photo" src="${esc(owner.photo)}" alt="${esc(owner.name)}" width="72" height="72" loading="lazy">`
  : `<span class="owner__initials" aria-hidden="true">${esc(initials)}</span>`;

let verification = '';
if (cfg.googleSiteVerification) verification += `<meta name="google-site-verification" content="${esc(cfg.googleSiteVerification)}">\n    `;
if (cfg.bingSiteVerification) verification += `<meta name="msvalidate.01" content="${esc(cfg.bingSiteVerification)}">\n    `;
const twitterHandle = cfg.twitterHandle ? `<meta name="twitter:site" content="@${esc(cfg.twitterHandle.replace(/^@/, ''))}">\n    <meta name="twitter:creator" content="@${esc(cfg.twitterHandle.replace(/^@/, ''))}">` : '';

const personLd = {
  '@type': 'Person',
  '@id': `${siteUrl}/#owner`,
  name: owner.name || '',
  jobTitle: owner.role || undefined,
  description: owner.bio || undefined,
  email: owner.email ? `mailto:${owner.email}` : undefined,
  url: owner.website || `${siteUrl}/`,
  image: owner.photo || undefined,
  address: owner.location ? { '@type': 'PostalAddress', addressLocality: owner.location } : undefined,
  sameAs: sameAs.length ? sameAs : undefined,
};

const tokens = {
  SITE_URL: siteUrl,
  SITE_HOST: siteUrl.replace(/^https?:\/\//, ''),
  APP_NAME: esc(cfg.appName || 'Voice Note Summarizer'),
  SHORT_NAME: esc(cfg.shortName || 'VN Summarizer'),
  VERSION: pkg.version,
  ASSET_V: `${pkg.version}-${Date.now().toString(36)}`,
  BUILD_DATE: today,
  YEAR: String(new Date().getFullYear()),
  REPO_URL: repo ? `https://github.com/${repo}` : '#',
  APK_URL: repo ? `https://github.com/${repo}/releases/latest/download/VoiceNoteSummarizer.apk` : '#',
  OWNER_NAME: esc(owner.name || ''),
  OWNER_ROLE: esc(owner.role || ''),
  OWNER_BIO: esc(owner.bio || ''),
  OWNER_LOCATION: esc(owner.location || ''),
  OWNER_EMAIL: esc(owner.email || ''),
  OWNER_LINKS_HTML: ownerLinks,
  OWNER_AVATAR_HTML: ownerAvatar,
  OWNER_PERSON_JSON: JSON.stringify(personLd),
  VERIFICATION_META: verification,
  TWITTER_HANDLE_META: twitterHandle,
};

const TEXT_EXT = new Set(['.html', '.css', '.js', '.json', '.webmanifest', '.xml', '.txt', '.svg', '']);
const stamp = (text) =>
  text.replace(/\{\{([A-Z_]+)\}\}/g, (m, key) => (key in tokens ? tokens[key] : m));

async function copyTree(from, to, { skip = () => false, rename = (p) => p } = {}) {
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const src = join(from, entry.name);
    const rel = src.slice(join(root, 'src').length + 1).replace(/\\/g, '/');
    if (skip(rel)) continue;
    const dest = join(to, rename(rel));
    if (entry.isDirectory()) { await copyTree(src, to, { skip, rename }); continue; }
    await mkdir(dirname(dest), { recursive: true });
    if (TEXT_EXT.has(extname(entry.name)) || entry.name.startsWith('_')) {
      await writeFile(dest, stamp(await readFile(src, 'utf8')));
    } else {
      await copyFile(src, dest);
    }
  }
}

const srcDir = join(root, 'src');
const dist = join(root, 'dist');
const www = join(root, 'www');
await rm(dist, { recursive: true, force: true });
await rm(www, { recursive: true, force: true });

// 1) Website
await copyTree(srcDir, dist);
await writeFile(join(dist, 'assets/js/config.js'),
  `window.VNS=${JSON.stringify({ apiBase: '', siteUrl, native: false, apkUrl: tokens.APK_URL, version: pkg.version })};\n`);

// 2) APK web bundle: the app page becomes index.html; API calls go to your live site.
const apkSkip = (rel) =>
  rel === 'index.html' || rel === '404.html' || rel.startsWith('privacy') || rel === 'sitemap.xml' ||
  rel === 'robots.txt' || rel === '_headers' || rel === '_redirects' || rel === 'sw.js' ||
  rel === 'manifest.webmanifest' || rel === 'assets/img/og-image.png' || rel.startsWith('assets/js/site') || rel.startsWith('assets/css/site');
await copyTree(srcDir, www, { skip: apkSkip, rename: (rel) => (rel === 'app/index.html' ? 'index.html' : rel) });
await writeFile(join(www, 'assets/js/config.js'),
  `window.VNS=${JSON.stringify({ apiBase: siteUrl, siteUrl, native: true, apkUrl: tokens.APK_URL, version: pkg.version })};document.documentElement.classList.add('native');\n`);

const warn = [];
if (/YOUR-GITHUB-USERNAME/.test(repo)) warn.push('githubRepo is still the placeholder');
if (!owner.name || owner.name === 'Your Name') warn.push('owner.name is still the placeholder');
console.log(`Built dist/ and www/ for ${siteUrl} (v${pkg.version}).`);
if (warn.length) console.log('Reminder: edit site.config.json —', warn.join('; '));
