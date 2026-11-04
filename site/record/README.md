# Scripted clip recording

Records the landing page clips (`../media/clips.json`) from a local run of the app with Playwright, so every clip has the same window, data and pace and can be re-recorded after a UI change with one command. The manual steps in `../media/RECORDING.md` still work; this is the faster path.

## One-time setup

```bash
cd site/record
npm install
npx playwright install chromium
```

`backend/.env` needs a test database and a test password (see `docs/test-login.md`):

```
MONGODB_URI=mongodb://127.0.0.1:27017/?replicaSet=rs0
MONGODB_DB_NAME=pairpocket_dev
CORS_ORIGINS=http://localhost:3000
FRONTEND_URL=http://localhost:3000
SECRET_KEY=<any long random value>
SESSION_COOKIE_SECURE=false
TEST_LOGIN_PASSWORD=<any long random value>
```

## Each session

1. `npm run mongo` (in `site/record`): a local MongoDB with no install or admin rights. The first run downloads the official `mongod` binary. It runs a one-node replica set because the app needs transactions. Data stays in `.mongo-data/`.
2. Start the backend (`uvicorn app.main:app --port 8000` in `backend`) and the frontend (`npm run dev` in `frontend`).
3. `node record.mjs <clip>`, for example `node record.mjs toggle`.

Each run resets the test accounts to the demo data (`--no-reset` skips it), signs in as Tester 3, gets to the first frame without recording, then records only the clip itself. It writes `../media/<clip>.mp4`, `.webm` and `-poster.webp` and prints the length and sizes. Frames are captured straight from Chrome at 2x pixel density, then scaled to 1280x800 and encoded once, so text stays sharp while the screen moves. `--keep-raw` keeps the captured frames in `../media/raw/<clip>-frames/`.

## Adding a clip

Create `clips/<id>.mjs` exporting:

- `setup(page)`: get to the first frame and wait until everything has loaded. Not recorded.
- `play(page, ui)`: the recorded part. `ui.click(locator)`, `ui.hover(locator)`, `ui.moveTo(x, y)` and `ui.pause(ms)` move a drawn pointer slowly (recorded videos have no mouse pointer).
- Optional: `account` (default `tester3`), `pointer` (where the pointer rests at the start, `[x, y]`), `crf` (mp4 quality, default `24`), `speed` (play faster than recorded, for example `1.5` for a long form).

Find labels and layout with a browser first (reading the page as text is enough), then write the steps. Afterwards set the clip to `"status": "done"` in `../media/clips.json` and run `node ../scripts/check.mjs`.
