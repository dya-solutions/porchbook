# Porchbook online: the private test site

**Address:** https://porchbook.app (test data only while JT builds; no real members yet). www.porchbook.app sends people to porchbook.app.

## How it is set up

| Part | Where | Notes |
| --- | --- | --- |
| Code | A **private** GitHub repository called `porchbook` | Never make it public: it contains the `bibles-private` folder. |
| Website | A Vercel project called `porchbook`, in JT's Vercel account (team DYA) | It is separate from the Numbers Radio project. Its functions run in Frankfurt (fra1), next to the database. |
| Database | Neon (free), added from the Vercel project's **Storage** tab | Vercel fills in `DATABASE_URL` by itself. The app creates and updates its own tables when it starts. |
| Photos and files | Vercel Blob (free), added from the **Storage** tab | Vercel fills in `BLOB_STORE_ID` by itself. Files can't be kept on Vercel's disk, so big uploads go here. |
| Emails | Brevo (free plan: 300 emails a day), sending from no-reply@porchbook.app as "Porchbook" | Online, codes are always really emailed. The "code on screen" test mode only works on JT's computer. |
| Address | porchbook.app and www.porchbook.app → Vercel | Two records in Cloudflare (where porchbook.app's DNS is managed), both set to **DNS only** (grey cloud): `CNAME @ → 3efd5aafdb7b1ce5.vercel-dns-017.com` (or Vercel's A records) and `CNAME www → 3efd5aafdb7b1ce5.vercel-dns-017.com`. On Vercel, www redirects (308) to porchbook.app. |
| Search engines | Told not to list the site | Controlled by the `PORCH_NOINDEX` and `VITE_PORCH_NOINDEX` settings. They stay `1` until JT says we're launching; then remove both and rebuild. |

## The settings (Vercel → the project → Settings → Environment Variables)

None of these are ever in the code or in git.

| Setting | What it is | Where the value comes from |
| --- | --- | --- |
| `DATABASE_URL` | The Neon database's address | Added automatically when Neon is connected |
| `BLOB_STORE_ID` | Which Blob store to use | Added automatically when Blob is connected. Vercel now connects Blob this way, without a separate key. |
| `BLOB_READ_WRITE_TOKEN` | Lets a phone send a big file straight to Blob | **Not set yet.** Only the "previously" video needs it, and that screen isn't in the app today. Online it says "storage isn't connected" until this is added from the Blob store's page. |
| `BETTER_AUTH_SECRET` | Keeps sign-ins safe | A long random value, made on JT's computer in `ONLINE-SECRET.txt` (next to the code folder, never uploaded) |
| `BETTER_AUTH_URL` | The site's own address (sign-in only works there) | `https://porchbook.app` |
| `BREVO_API_KEY` | Lets the site send emails through Brevo | Brevo → your name (top right) → SMTP & API → API Keys → Generate a new API key |
| `BREVO_SENDER_EMAIL` | Who the emails come from | `no-reply@porchbook.app` |
| `BREVO_SENDER_NAME` | The sender's name | `Porchbook` |
| `PORCH_PLATFORM_OWNERS` | Who is the platform owner (approves new porches, edits the FAQ) | JT's own email (more than one: separate them with commas) |
| `PORCH_NOINDEX` | Tells search engines not to list the site | `1` |
| `VITE_PORCH_NOINDEX` | The same, inside each page | `1` |

**Never set `PORCH_TEST_MODE` online.** (The site refuses it anyway.)

## Test data (while JT builds)

Two made-up churches, **Alpha Test Church (TEST)** and **Bravo Test Church (TEST)**, with made-up people. They're added by `scripts/online-test-data.mjs`.
- **Every test person's email ends in `@test.porchbook.app`.** That is a made-up address nobody can own, so no code is ever emailed to them.
- **Every test church** is listed in the table `porch_test_data`, and its name ends in "(TEST)".
- **Their passwords** are only in `TEST-ACCOUNT.md`, next to the code folder (never uploaded).

The script needs the database's address (from Neon: Vercel → Storage → the database → **.env.local** → `DATABASE_URL`). It's kept in `NEON-URL.txt` next to the code folder, as one line `DATABASE_URL=…`, and is never uploaded.

- See what's there: `node --env-file=../NEON-URL.txt scripts/online-test-data.mjs show`
- Add the test churches: `node --env-file=../NEON-URL.txt scripts/online-test-data.mjs add ../TEST-ACCOUNT.md`

## Before launch

1. **Remove all test data in one go.**
   - First count what would go (nothing is removed): `node --env-file=../NEON-URL.txt scripts/online-test-data.mjs remove`
   - Then really remove it: `node --env-file=../NEON-URL.txt scripts/online-test-data.mjs remove --yes`
   - **What goes:** every `@test.porchbook.app` account, both test churches, and everything posted in them.
   - **What stays:** real people who joined a test church to try it just leave it; their accounts stay.
2. Remove `PORCH_NOINDEX` and `VITE_PORCH_NOINDEX` from Vercel's settings and rebuild, so search engines may list the site.
3. Delete the test passwords section from `TEST-ACCOUNT.md`.

## How to update the site after a future stage

1. On JT's computer, Claude saves the stage (an undo point) as usual.
2. Claude sends it to GitHub: `git push`.
3. **Vercel sees the change and rebuilds the site by itself**, in about 2 to 4 minutes. You can watch it under the project's **Deployments** tab. The newest one shows **Ready** when it's live.
4. If something goes wrong, open **Deployments**, choose the previous one that worked, and press **Promote** (or **Instant Rollback**). The site goes back straight away.

The database keeps its data between updates. New tables and columns are added by the app itself when it starts.

## Backups of the database (Neon branches)

Before a big change to the database, JT makes a free copy in Neon: Vercel → Storage → porchbook → **Open in Neon** → **Branches** → **Create branch** (from the main branch, with the current data).

| Branch | Made | Before |
| --- | --- | --- |
| `before-m1-m2` | 25 Nov 2026 | Many porches, steps M1 and M2 (Psalmist; the membership list `porch_members`) |

**How to go back to `before-m1-m2` if ever needed** (do both, in this order):
1. **The code:** in Vercel, open **Deployments**, choose the last deployment *before* "M1 + M2" (commit `4094673`, "Decisions 24-34…"), and press **Promote** (or **Instant Rollback**). The site goes back to the old code straight away.
2. **The data:** in Neon, open **Branches**, choose the main branch → **Restore** → restore from the branch `before-m1-m2`. Neon keeps the replaced data as a backup branch of its own, so this step can be undone too.
   - Anything posted or changed online after the backup was made is lost by this step. While only test data is online, that doesn't matter.
3. Open https://porchbook.app and check it works.

**Going back only the code (step 1)** is fine for a quick fix: the old code ignores the new membership list and puts back its own "one porch each" rules when it starts. The one thing that wouldn't work is starting a new "Gospel artist" porch, since the database now calls that type Psalmist. **To go back fully, do both steps.**

Delete old backup branches in Neon once a change has settled, as the free plan allows only a few branches.

## Good to know

- **The free limits:** Neon has 0.5 GB of database, Blob has 1 GB of files, and Brevo sends 300 emails a day. That's plenty for testing.
- **Photos in posts** are still kept inside the database, as they are on JT's computer. Only big files (like the "previously" video) go to Blob.
- **Not online yet:** calls between phones (Stage 8 sets up a free way). The test site can show the calls screen, but calls may not connect.
- **The local copy** on JT's computer keeps working exactly as before. It does not use the online database.
