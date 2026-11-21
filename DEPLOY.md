# Porchbook online: the private test site

**Address:** https://test.porchbook.app (test data only, no real members yet).

## How it is set up

| Part | Where | Notes |
| --- | --- | --- |
| Code | A **private** GitHub repository called `porchbook` | Never make it public: it contains the `bibles-private` folder. |
| Website | A Vercel project called `porchbook`, in JT's Vercel account | It is separate from the Numbers Radio project. |
| Database | Neon (free), added from the Vercel project's **Storage** tab | Vercel fills in `DATABASE_URL` by itself. The app creates and updates its own tables when it starts. |
| Photos and files | Vercel Blob (free), added from the **Storage** tab | Vercel fills in `BLOB_READ_WRITE_TOKEN` by itself. Files can't be kept on Vercel's disk, so uploads go here. |
| Emails | Brevo (free plan: 300 emails a day), sending from no-reply@porchbook.app as "Porchbook" | Online, codes are always really emailed. The "code on screen" test mode only works on JT's computer. |
| Address | test.porchbook.app → Vercel | Added as a CNAME record where porchbook.app was bought. porchbook.app itself is unused for now. |
| Search engines | Told not to list the site | Controlled by the `PORCH_NOINDEX` and `VITE_PORCH_NOINDEX` settings. |

## The settings (Vercel → the project → Settings → Environment Variables)

None of these are ever in the code or in git.

| Setting | What it is | Where the value comes from |
| --- | --- | --- |
| `DATABASE_URL` | The Neon database's address | Added automatically when Neon is connected |
| `BLOB_READ_WRITE_TOKEN` | Permission to store files in Blob | Added automatically when Blob is connected |
| `BETTER_AUTH_SECRET` | Keeps sign-ins safe | A long random value, made on JT's computer in `ONLINE-SECRET.txt` (next to the code folder, never uploaded) |
| `BETTER_AUTH_URL` | The site's own address | `https://test.porchbook.app` |
| `BREVO_API_KEY` | Lets the site send emails through Brevo | Brevo → your name (top right) → SMTP & API → API Keys → Generate a new API key |
| `BREVO_SENDER_EMAIL` | Who the emails come from | `no-reply@porchbook.app` |
| `BREVO_SENDER_NAME` | The sender's name | `Porchbook` |
| `PORCH_PLATFORM_OWNERS` | Who is the platform owner (approves new porches, edits the FAQ) | JT's own email (more than one: separate them with commas) |
| `PORCH_NOINDEX` | Tells search engines not to list the site | `1` |
| `VITE_PORCH_NOINDEX` | The same, inside each page | `1` |

**Never set `PORCH_TEST_MODE` online.** (The site refuses it anyway.)

## How to update the site after a future stage

1. On JT's computer, Claude saves the stage (an undo point) as usual.
2. Claude sends it to GitHub: `git push`.
3. **Vercel sees the change and rebuilds the site by itself**, in about 2 to 4 minutes. You can watch it under the project's **Deployments** tab. The newest one shows **Ready** when it's live.
4. If something goes wrong, open **Deployments**, choose the previous one that worked, and press **Promote** (or **Instant Rollback**). The site goes back straight away.

The database keeps its data between updates. New tables and columns are added by the app itself when it starts.

## Good to know

- **The free limits:** Neon has 0.5 GB of database, Blob has 1 GB of files, and Brevo sends 300 emails a day. That's plenty for testing.
- **Photos in posts** are still kept inside the database, as they are on JT's computer. Only big files (like the "previously" video) go to Blob.
- **Not online yet:** calls between phones (Stage 8 sets up a free way). The test site can show the calls screen, but calls may not connect.
- **The local copy** on JT's computer keeps working exactly as before. It does not use the online database.
