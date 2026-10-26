# Voice Note Summarizer

Turn long WhatsApp voice notes into three lines. Urdu, Punjabi and English.

- **Website + online app** on Cloudflare Pages (free)
- **AI** on Cloudflare Workers AI: Whisper for speech-to-text, Llama for the summary (free daily allowance, no API keys)
- **Android APK** built automatically by GitHub Actions (free). No Android Studio, no powerful computer needed.

You need only a browser, a free GitHub account and a free Cloudflare account.

---

## Step 1: Put in your details (2 minutes)

Open `site.config.json` and change:

| Field | What to put |
|---|---|
| `siteUrl` | Your website address. Keep `https://voice-note-summarizer.pages.dev` for now; you'll confirm it in Step 4. |
| `githubRepo` | `your-github-username/voice-note-summarizer` |
| `owner.name`, `owner.email`, `owner.role`, `owner.bio`, `owner.location` | Shown in the footer and in Google's data about the site |
| `owner.github`, `owner.linkedin`, `owner.website`, `owner.twitter`, `owner.instagram`, `owner.phone` | Leave any you don't want as `""`. Empty ones are hidden. |
| `owner.photo` | Optional. A link to your photo, or put a file in `src/assets/img/` and write `/assets/img/me.jpg`. Without it, your initials are shown. |

Everything else (footer, SEO data, privacy page, download links) updates from this one file.

## Step 2: Put the code on GitHub

1. Go to github.com → **New repository** → name it `voice-note-summarizer` → **Public** → Create.
2. Easiest upload: install **GitHub Desktop** (free, light), choose *Add existing repository* → pick this folder → *Publish*.
   *Or* on the repo page: **Add file → Upload files** and drag in everything inside this folder.
   ⚠️ The web uploader often skips the hidden `.github` folder. If after uploading you don't see `.github/workflows/android-apk.yml` in the repo, click **Add file → Create new file**, type the name `.github/workflows/android-apk.yml`, and paste in that file's contents.
3. **Add the APK signing key** (do this once, it keeps updates installing smoothly):
   Repo → **Settings → Secrets and variables → Actions → New repository secret**. Create two secrets using the values from `KEEP-PRIVATE-apk-signing-key.txt` (this file came next to this folder, not inside it):
   - `ANDROID_KEYSTORE_BASE64`
   - `ANDROID_KEYSTORE_PASSWORD`

   🔒 Never upload that text file to GitHub. Keep a copy somewhere safe (Google Drive, email to yourself). If you lose it, future APKs can't update the installed app; people would have to uninstall first.

## Step 3: Get your APK (automatic, about 6 minutes)

1. Repo → **Actions** tab. If asked, click *I understand my workflows, enable them*.
2. Click **Build Android APK → Run workflow** (it also runs by itself on every change you push).
3. When it shows a green tick, open **Releases** (right side of the repo page). `VoiceNoteSummarizer.apk` is there.

The website's **Download APK** button always points to the newest release:
`https://github.com/YOUR-USERNAME/voice-note-summarizer/releases/latest/download/VoiceNoteSummarizer.apk`
(Short link once the site is live: `your-site/download`.)

## Step 4: Put the website online with Cloudflare (free)

1. dash.cloudflare.com → sign up → **Workers & Pages → Create → Pages → Connect to Git** → choose your repo.
2. Build settings:
   - Framework preset: **None**
   - Build command: `npm run build`
   - Build output directory: `dist`
3. **Save and Deploy**. Your site appears at `https://<project-name>.pages.dev`.
4. **AI binding:** `wrangler.toml` connects Workers AI automatically. Check it works by opening `https://your-site/api/health`; it should show `"ai": true`.
   If it shows `false`: Pages project → **Settings → Bindings → Add → Workers AI**, variable name `AI`, then **Deployments → Retry deployment**.
5. If your address is **not** exactly `https://voice-note-summarizer.pages.dev`, put the real one in `siteUrl` in `site.config.json` and commit. This matters twice: Google needs the right address, and **the APK sends voice notes to this address**. (GitHub rebuilds the APK automatically after the change.)

**Own domain (optional, ~$10/year):** Pages project → Custom domains → add it, then update `siteUrl`.

### Free limits
Workers AI gives 10,000 "neurons" free per day. One 6-minute note uses roughly 300–600, so expect around **15–30 summaries a day for free**. After that, users see "Daily free limit reached… try again later" until it resets (midnight UTC). For more, enable Workers paid ($5/month) in Cloudflare.

## Step 5: Get on Google and Bing

The site already has what search engines look for: a clear title and description, structured data (app, FAQ, author), sitemap, robots.txt, fast pages and social preview images. Lighthouse scores: SEO 100, Accessibility 100, Best Practices 100, Performance 98–100.

Do these once the site is live:

1. **Google Search Console** (search.google.com/search-console) → Add property → *URL prefix* → your site URL → verify with *HTML tag*. Copy only the `content="…"` value into `googleSiteVerification` in `site.config.json`, commit, wait for the deploy, click **Verify**.
2. In Search Console: **Sitemaps** → enter `sitemap.xml` → Submit. Then **URL inspection** → paste your home URL → **Request indexing**.
3. **Bing Webmaster Tools** (bing.com/webmasters) → *Import from Google Search Console*. This also covers Yahoo and DuckDuckGo.

**About ranking honestly:** nobody can guarantee page one. Google usually indexes a new site within a few days to two weeks. What moves you up after that:
- **Links from other sites.** Post it in Facebook groups, Reddit (r/pakistan, r/lahore), LinkedIn, Product Hunt, your GitHub profile README. Each real link helps.
- **People searching your exact name.** Share the link in family/friends groups; "voice note summarizer" searches that click your site build trust.
- **Fresh, useful pages.** A blog post like "How to read a WhatsApp voice note without listening" can rank for those searches and link to the app.

## Step 6: Check social previews

Paste your URL into these to see the preview (and refresh old cached ones):
- Facebook / WhatsApp: developers.facebook.com/tools/debug
- LinkedIn: linkedin.com/post-inspector
- Any platform: opengraph.xyz

WhatsApp caches previews per link, so test with a fresh link such as `your-site/?v=1`.

---

## How it works

```
Voice note (.opus) → phone decodes it → 16 kHz chunks (1 min each, 3 at a time)
   → /api/transcribe (Whisper large-v3-turbo) → transcript
   → /api/summarize (Llama 3.3 70B, falls back to Llama 3.1 8B) → 3 lines + Roman Urdu + details + replies
```
Nothing is stored. The Android app adds itself to WhatsApp's **Share** menu for audio.

## Project layout

```
site.config.json          ← your details (edit this)
src/                      ← website + app source ({{TOKENS}} are filled from the config)
  index.html              landing page
  app/index.html          the summarizer (also the APK's screen)
  privacy/, 404.html, sitemap.xml, robots.txt, manifest.webmanifest, sw.js
  assets/css, js, img, fonts
functions/api/            ← Cloudflare backend: transcribe.js, summarize.js, health.js
android/                  ← Android project (Capacitor 8); share-from-WhatsApp code in
                            app/src/main/java/com/voicenotesummarizer/app/
scripts/build.mjs         ← builds dist/ (website) and www/ (APK)
.github/workflows/        ← builds and publishes the APK
```

## Changing things

- **Text on the landing page:** `src/index.html`. Colours and layout: `src/assets/css/site.css`. Commit, and both the site and the APK rebuild by themselves.
- **Summary style:** the instructions to the AI are in `functions/api/summarize.js` (`systemPrompt`).
- **Different AI model:** in Cloudflare Pages → Settings → Variables, add `SUMMARY_MODEL` (for example `@cf/meta/llama-3.1-8b-instruct-fast` to use fewer neurons).
- **App name/ID:** keep `com.voicenotesummarizer.app`. Changing it means a new app that can't update the old one.

## Troubleshooting

| Problem | Fix |
|---|---|
| APK says "App not installed" when updating | The signing secrets weren't set for one of the builds. Uninstall, install the newest APK; make sure both secrets exist. |
| Play Protect warns about the APK | Normal for apps not from the Play Store. Tap *More details → Install anyway*. Publishing to Play Store ($25 once) removes this. |
| App says "Could not reach the summarizer" | `siteUrl` in the config doesn't match your live site, or the site isn't deployed. Check `/api/health`. |
| `/api/health` shows `"ai": false` | Add the Workers AI binding (Step 4.4). |
| "Daily free limit reached" | Free daily allowance used up; it resets at midnight UTC. |
| GitHub Action fails at "Install" | Make sure `package-lock.json` was uploaded. |
| Voice note not in WhatsApp's Share list | Long-press the voice note itself (not the chat), tap Share (↪). Reinstall the app if it was installed while an older version existed. |

## Run it on your computer (optional)

Needs Node.js 22. `npm install`, then `npm run dev` (asks you to log in to Cloudflare once so the AI works locally).
