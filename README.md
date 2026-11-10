# Subdivide Finder (GitHub + Supabase version)

Your own copy of Subdivide Finder, hosted on GitHub Pages, with its data in your Utopian CRM Supabase project (`yahosblylysopbxgztvg`). It works like the claude.ai page:

- **Deals:** screened tracts with numbers, links, Land Portal check, stage, the first-email writer, and the offer tracker.
- **Agent inbox:** live agent replies from Gmail; type the gist and Claude writes the reply.
- **Offers:** a log of the offers you've made.
- **Counties:** queue new searches.

## What's in here

| File | What it does |
|---|---|
| `site/index.html` | The app (one page) |
| `site/sf-adapter.js` | Connects the page to Supabase, Gmail and Claude |
| `site/config.js` | Your settings (Supabase URL and public key are already filled in; you add the Google client ID) |
| `supabase/migrations/20261109000000_subdivide_finder.sql` | Creates the `sf_` tables, security rules and live updates. Touches no CRM table |
| `supabase/seed/sf_seed_2026-11-09.sql` | Today's TN search: 1 run, 53 deals, 12 agent emails. **Has agent contacts, so it's git-ignored** |
| `supabase/functions/sf-draft/index.ts` | Edge Function that has Claude write emails (needs an Anthropic API key) |
| `.github/workflows/pages.yml` | Publishes `site/` to GitHub Pages on every push |

On a Mac, files and folders that start with a dot (`.github`, `.gitignore`) are hidden in Finder. Press **Cmd + Shift + .** to show them.

---

## 1. Supabase: create the tables (5 min)

1. Open [supabase.com/dashboard](https://supabase.com/dashboard) → your CRM project → **SQL Editor** → **New query**.
2. Paste all of `supabase/migrations/20261109000000_subdivide_finder.sql` and press **Run**. You should see "Success. No rows returned."
3. New query: paste all of `supabase/seed/sf_seed_2026-11-09.sql` and press **Run**.
4. Check it: run `select count(*) from sf_deals;` and you should get **53**.
5. To let a teammate in, run: `insert into sf_members (email) values ('their@email.com');` They sign in with their CRM login. (Your CRM login and business email are already added in the live database.)

## 2. Supabase: allow the site's address for sign-in links

**Authentication → URL Configuration → Redirect URLs → Add URL:**

```
https://nishrav2-tech.github.io/subdivide-finder/
http://localhost:8000/
```

The site signs you in with your CRM email and password. If you leave the password blank, it emails you a sign-in link instead.

## 3. Supabase: the Claude writing function (5 min)

1. Get an API key at [console.anthropic.com](https://console.anthropic.com) → **API Keys**. Usage is billed there, separately from your Claude plan. Each email is a few cents or less.
2. In Supabase: **Edge Functions → Secrets → Add new secret**: name `ANTHROPIC_API_KEY`, value = your key.
3. **Edge Functions → Deploy a new function → Via Editor**. Name it exactly `sf-draft`, replace the sample code with all of `supabase/functions/sf-draft/index.ts`, then press **Deploy**.

If you'd rather use Terminal (needs the Supabase CLI, `brew install supabase/tap/supabase`):

```bash
cd ~/Downloads/subdivide-finder
supabase login
supabase functions deploy sf-draft --project-ref yahosblylysopbxgztvg
supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref yahosblylysopbxgztvg
```

## 4. Google: let the site read and send your Gmail (10 min)

The site talks to Gmail straight from your browser. No password or token is stored on any server.

1. Go to [console.cloud.google.com](https://console.cloud.google.com), signed in as **jay@utopiancapitalinvest.com**, and create a project called "Subdivide Finder".
2. **APIs & Services → Library →** search **Gmail API → Enable**.
3. **APIs & Services → OAuth consent screen**: User type **Internal** (only your Workspace can use it, so Google needs no review). App name "Subdivide Finder", support email yours, then Save.
4. **Data access / Scopes**: add `gmail.readonly` and `gmail.send`.
5. **Credentials → Create credentials → OAuth client ID** → Application type **Web application** → **Authorized JavaScript origins**:
   ```
   https://nishrav2-tech.github.io
   http://localhost:8000
   ```
   Then **Create** and copy the **Client ID**.
6. Paste it into `site/config.js` in place of `PASTE_YOUR_CLIENT_ID.apps.googleusercontent.com`.

On the site, press **Connect Gmail** once per session. Google keeps it connected for about an hour, then the button comes back.

## 5. GitHub: publish the site (5 min)

1. On github.com (account `nishrav2-tech`): **New repository** → name `subdivide-finder` → Public → Create. Public is fine because no secret is in the repo. The seed file with deal data is git-ignored and never uploaded.
2. Upload the files, either way:
   - **Drag and drop:** on the empty repo page click **uploading an existing file**, then drag in `site`, `supabase` and `.github` (show hidden files first with Cmd + Shift + .), `.gitignore` and `README.md`. **Do not drag in `supabase/seed`.** Commit.
   - **Terminal:**
     ```bash
     cd ~/Downloads/subdivide-finder
     git init -b main
     git add .
     git commit -m "Subdivide Finder"
     git remote add origin https://github.com/nishrav2-tech/subdivide-finder.git
     git push -u origin main
     ```
3. Repo → **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. **Actions** tab: wait for the green check (about 1 minute). Your site is live at **https://nishrav2-tech.github.io/subdivide-finder/**.

Every later change to `site/` goes live on push. To try it on your Mac first: `cd site && python3 -m http.server 8000`, then open http://localhost:8000 (don't double-click the file; `file://` blocks Supabase).

## 6. The county queue

When you add counties on the **Counties** tab, a run is saved in `sf_runs` with status `queued`. The scheduled Claude task (12:47, 4:47 and 8:47 PM Central, Mac on and Chrome open) or "run the queue" in chat picks it up, runs the full Zillow/Redfin/CRM/Land Portal pipeline, and writes deals back to `sf_deals`. It never sends email; you send from the site.

Once this site is live, tell Claude to "switch Subdivide Finder to Supabase". The scheduled task then reads and writes these tables, not the claude.ai page, so there's one source of truth.

## Troubleshooting

- **"This account can't use Claude drafting"**: your sign-in email isn't in `sf_members` (step 1.5), or the `sf-draft` function isn't deployed.
- **Connect Gmail does nothing**: the client ID in `config.js` is missing, or the site's address isn't in Authorized JavaScript origins (step 4.5).
- **Blank page after sign-in**: open the browser console (Cmd + Option + J) and check for a red error, usually a typo in `config.js`.
- **Sent emails** appear in your Gmail Sent folder, threaded with the agent's emails. The signature comes from `SIGNATURE_TEXT` in `config.js`, because Gmail's API doesn't add your Gmail signature.
