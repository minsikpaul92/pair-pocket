# Recording guide

The landing page plays short silent clips of the real app. Eight clip slots exist (see `clips.json`). Four are placeholders on the page until the file `media/<id>.mp4` exists; the others currently use clips copied from `docs/demo/` and should be re-recorded so every clip looks the same.

## Setup (once)

- Use the test server's linked couple (`docs/test-login.md`, "Reset to linked couples with accounts") or a local run, so no real data appears. Use the Tester 3 and 4 accounts (English) for the English-looking clips.
- Browser window: exactly 1280x800 of page content (use the browser's device toolbar or `resize`), light theme, zoom 100%, no bookmarks bar, no extensions in the frame, mouse cursor visible.
- Move slowly. Pause half a second before and after each key action. Each clip is 8 to 12 seconds and should loop cleanly, so end on the same screen you started from where possible.
- Tool: QuickTime (File > New Screen Recording) or any recorder at 30 or 60 fps.

## Clips

| File id | Output size | What to show |
| --- | --- | --- |
| `toggle` | 1280x800 | Dashboard in Personal, tap the Shared toggle, numbers change, tap Personal again. Hero clip, so make it the cleanest. |
| `add-entry` | 1280x800 | Tap add, type a merchant (a suggestion appears), pick a category, enter an amount, save. The new row appears in the list. |
| `ai-scan` | 1280x800 | Tap the camera, choose a receipt photo, the draft fills in, review screen, save. |
| `settlement` | 1280x800 | Open a shared expense paid from a personal account, choose Settle, pick the account, confirm. Show that the expense now says Settled and both ledgers got an entry. |
| `moves` | 1280x800 | List view with a credit card payment and an account-to-account move marked as transfers. Switch to the dashboard and show the spending chart does not include them. |
| `subscriptions` | 1280x800 | Fixed expenses tab, add a subscription with a promo price, save, show "Due this month" updating. |
| `stocks` | 1280x800 | Stocks tab with two brokerage accounts (one Canada, one Korea), live prices, totals in both currencies. |
| `invite` | 1280x800 | Invite partner dialog, type an email, choose the shared start date, send. |

Only show features that are shipped (see the README). Do not show planned items from `docs/ROADMAP.md`.

## Convert

Put the recording at `site/media/raw/<id>.mov` (the `raw` folder is not committed) and run, from the repo root:

```bash
id=settlement
ffmpeg -y -i site/media/raw/$id.mov -an -vf "fps=30,scale=1280:-2,format=yuv420p" -c:v libx264 -crf 26 -preset slow -movflags +faststart site/media/$id.mp4
ffmpeg -y -i site/media/raw/$id.mov -an -vf "fps=30,scale=1280:-2" -c:v libvpx-vp9 -crf 38 -b:v 0 site/media/$id.webm
ffmpeg -y -ss 2 -i site/media/raw/$id.mov -frames:v 1 site/media/$id-poster.png
cwebp -q 80 site/media/$id-poster.png -o site/media/$id-poster.webp
```

Delete the temporary `-poster.png`. Pick a poster frame (`-ss`) where the screen is fully loaded, not a spinner.

## Size budget

Each MP4 at most 450 KB (the hero `toggle` at most 700 KB), poster at most 40 KB. If a clip is bigger, shorten it, lower `fps` to 24, or raise `-crf`. `node site/scripts/check.mjs` fails over budget.

## Switch a slot from placeholder to real

1. Add the files above under the same id.
2. In `clips.json`, set that clip's `status` to `done` and update `w`/`h` if the size differs from 1280x800.
3. Run `node site/scripts/build.mjs`. The placeholder is replaced by the video automatically.
