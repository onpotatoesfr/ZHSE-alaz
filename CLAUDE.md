# ZHSE-A — Project handoff (read this fully before doing anything)

This file exists so a brand-new Claude Code session can continue development
without the user (CeZo) re-explaining the project. Follow it exactly. Do not
add features that aren't requested. Do not simplify requirements.

---

## 0. WORKFLOW RULES — never ignore these

- **Never push to GitHub unless the user explicitly says `push`, `publish`, `update it`, or `force update`.** Build and commit locally, but pushing is always on their word.
- **`force update` / `publish` / `update it` means:** bump the build number (see §3), then commit **and** push. A plain `push` means push what's committed (bump the build first if the board app changed and it needs to reach boards).
- **Panel-only changes** (`adm/panel.html`) don't need a board build bump — the panel is fetched live. Bump `PANEL_VER` and push the panel.
- **Test every change before saying it's done.** Headless Playwright against the real file (see §12). Don't claim something works without running it.
- **When told to change X, change only X.** The user is strict about this ("nothing less nothing more"). Don't touch, restyle, reorder, or "improve" anything they didn't ask about.
- **Don't add features without being asked.** Suggest, don't build.
- **Mockups are artifacts, not repo files.** When building a visual concept, author an HTML file, publish it as a claude.ai artifact, then **move the file out of the repo** (into scratch) so the GitHub Pages site stays clean. Only real app files live in the repo.
- **Never show the update/GitHub address anywhere in the app UI.** The update base URL is deliberately base64-obfuscated in code (`UP_DEFAULT` in index.html, `UPB`). Telling the user their own repo URL in chat is fine; putting it on a board screen is not.
- **The remote admin panel must only work on the user's own PC** (it's gated by the admin key). No on-screen notice appears on a board while it's being viewed/controlled.
- Commit messages end with the attribution lines the session is told to use (in this project so far: `Co-Authored-By: Claude ...` + a `Claude-Session:` line). Keep whatever the environment specifies.

## 1. Communication style (how CeZo works with you)

- Concise, choice-driven. Don't over-explain. Don't ask "should I continue?" — just continue.
- He iterates fast, one change at a time, and usually says `force update` after each change he approves.
- Be honest about hard constraints (e.g. offline PPTX rendering) instead of pretending.
- If something he asks for is irreversible/risky (can brick boards), warn him once, clearly, before deploying — but still do what he decides.

---

## 2. What the project is

- **ZHSE-A** is an Android whiteboard app for **SMART Board MX** touch displays, branded for the **Zhyar Educational Foundation (ZHSE)**.
- It is a **single-file web app** (`index.html`) wrapped into an **APK** (the user built the APK). The APK is a **WebView** that loads the live site. The user maintains the APK project separately (Claude can't build the APK here).
- Hosted on **GitHub Pages**, repo **`github.com/onpotatoesfr/ZHSE-alaz`**, branch **`main`**.
  - Live app: `https://onpotatoesfr.github.io/ZHSE-alaz/`
  - Admin panel: `https://onpotatoesfr.github.io/ZHSE-alaz/adm/panel.html`
- Interface languages: **English, Kurdish (Sorani, ckb), Arabic (ar)** — translation map `TR` in index.html.

### Files in the repo
- `index.html` — the whole board app (~300 KB, one big script). **Source of truth for all app constants.**
- `adm/panel.html` — the PC remote admin panel (served live, versioned by `PANEL_VER`).
- `sw.js` — the offline service worker (see §10).
- `version.json` — forced-update manifest (see §3).
- `admin.json` — holds the admin public key: `{"k":"<raw base64url ECDSA P-256 public key>"}`.
- `send.html` — phone/laptop file-send page (QR target; 2 MB limit; currently handles images + PDF).
- `robots.txt`, `.nojekyll`.
- `CLAUDE.md` — this file.

---

## 3. Build & version system (how updates reach boards)

- Board build is declared once in `index.html`: `const VER='1.1',BUILD='2026.10.31.71',BD='31/10/65';`
  - `BUILD` is the internal version `YYYY.MM.DD.N` (N is a running counter).
  - `BD` is the human display `day/month/M` (M is a separate running counter shown to users).
  - **Current board build: `2026.10.31.71` / display `31/10/65`.**
- `version.json` mirrors it: `{"version","build","disp","force":true,"notes","items":[...]}`. `items` is the "What's New" list shown on boards after an update.
- **To roll out a board change (force update):** bump `BUILD` + `BD` in index.html **and** `build` + `disp` in version.json (keep `force:true`), set `items` to the human-readable changes, then commit + push.
- **Forced update mechanism:** boards poll `version.json` every ~15s; if a newer `build` with `force:true` is seen, the board shows a 5-second "Updating…" notice (with "Not now"), then installs and restarts. Logic lives in index.html (`fuCheck`/`fuWait`/`fuCount`/`upInstall`).
- **Panel version:** `const PANEL_VER='11';` in adm/panel.html. **Current panel: v11.** The panel self-updates (a small loader fetches it from GitHub). Bump `PANEL_VER` on panel changes.

---

## 4. Architecture / technical details

### Relay (ntfy.sh, free tier)
- Base stats/heartbeat topic `ST = https://ntfy.sh/zhse-a-st-66fc6d0b33b1d4f5fdc55ec4`.
- `CMD = ST+'-c'` (admin→board commands), `RSP = ST+'-r'` (responses). Panel defines these at adm/panel.html ~line 108.
- Board stats topics in index.html: `BSU = https://ntfy.sh/zhse-a-st-66fc6d0b33b1d4f5fdc55ec4`, `BSC = BSU+'-c'`.
- Free-tier limits respected deliberately: 250 msgs/day, 2 MB attachments, 12h retention. Boards do **not** heartbeat constantly (only on start / when asked / when renamed) to stay under the limit.

### Remote admin command security
- Admin key = **ECDSA P-256** keypair. Private JWK in the PC's `localStorage['zhse-admin-key'] = {priv,pub}`. Public raw key is published to `admin.json` as `{k:pub}`.
- Signed command payload: `{z:9, p:JSON.stringify([to, c, a, timestamp, nonce]), s:signature}`.
  - `to` = `'all'` | a board id | an array of board ids.
  - `c` = `'set'` or `'act'`; `a` = args.
- Board side: `raMsg`→`raVerify` (checks signature against the trusted public key, rejects forged keys and replayed nonces)→`raExec`:
  - `raExec(c,a)`: `c=='set'` → `raSet(a.k,a.v)`; `c=='act'` → `raAct(a.n,a)`.
  - `raAct` cases include: `clear, newpage, prev, next, closepdf, mode, exam, examEnd, examAdd, lock, unlock, msg, msgClose, saver, wake, wipe, closeAll, restart, toolbarReset, wg` (welcome/goodbye).
- **Live view/control:** WebRTC (`RTCPeerConnection` + STUN) for encrypted screen view + mouse/keyboard control from the panel. Panel `req(c,a)` sends over the data channel when connected; otherwise falls back to the signed ntfy command.
- **Panel gate:** the panel hides all boards/controls until its admin key is trusted by the boards (published key in admin.json matches). Shows "Waiting for the boards to trust this PC", a "Show my code" button and "Check again"; re-checks every 20s. (PANEL feature, "v7".)
- **Board id/name:** `bsName()` returns `localStorage['wbn']` or `'Board '+BS.id`. Used for `{board.ID}` substitution.

### Settings / storage keys (localStorage)
- `wb1`/`wb1b` pages + recovery backup, `wb2` settings (S), `wba` admin settings (AD), `wbn` board name, `wbp` app passcode, `wbu` unlock time, `wbUpd` installed-update record, `zhse-admin-key` admin key, `wbWG` + `wbWGd` welcome/goodbye schedule + last-shown-day, `wb_selmig`/`wb_selmig2` one-time toolbar migrations, `wbhb` heartbeat time.
- Panel: `zhse-cats` categories, `zhse-hidden` forgotten boards, `zhse-wg` welcome/goodbye config, `zhse-alog` activity history, `zhse-notes` per-board maintenance notes.

---

## 5. Admin panel (adm/panel.html) — requirements & current features

Implemented:
- Admin key management (generate, show code, download/import plain key backup). **(The password-protected key backup was removed at user request — do not re-add.)**
- Board discovery from the relay (12h history + live SSE), board list.
- **Categories** (group boards) + **multi-select** (control several boards/categories at once) + **category rename**.
- **Gate** (hide everything until key trusted).
- **Forget board** (✕ on each board row, persisted per-PC in `zhse-hidden`) + "N hidden · tap to restore".
- **Board health** overview (shown on the "All boards" view): online/offline counts, per-board last-seen, build, update-ready flag.
- Per-board settings (passcode, clock, finger drawing, screen saver, Mr. Wrya mode + name, language, toolbar theme, screen-saver background, handwriting beautification), rename, actions (force update, restart, clear/new/prev/next page, close menus, close PDF, whiteboard/split view, lock/unlock, screen saver now/wake, reset toolbar, erase all pages), exam mode, on-screen message, send a file (picture/PDF), AI neat-writing key.
- **Welcome screens** button → modal: one global schedule for **all** boards (welcome message + time AM/PM, goodbye message + time AM/PM, enable). "Send to all boards" broadcasts `act {n:'wg',...}`. Stored in `zhse-wg`.
- **History** button → activity log of every command sent from the panel (newest first, `zhse-alog`, with Clear).
- **Per-board maintenance notes** textarea in each board's detail (saved per board id in `zhse-notes`).

---

## 6. Features currently implemented (board app)

Carried over from before this handoff: splash screen, forced-update system, "What's New" popup, app animations, board clock (Tools › Clock), calculator, **GeoGebra** (real GeoGebra online, built-in offline graph; now auto-switches live on connectivity change), PDF viewing + drawing, **Photo from phone** / **PDF from phone** (QR via send.html), **Exam mode**, **Screen saver** (idle; custom background options set from admin), **real-time handwriting beautification** (normal pen; on/off in admin; **off by default**), **AI neat writing** (Google handwriting stroke recognition + Gemini fallback; **works only on the board named "Naz Tablet"**), remote admin + live view/control, send files from PC, undo/redo + page-arrow fade when unavailable, exam-end sound, **true black** pen (`#000000`).

Added/changed in the most recent work:
- **Tabbed admin menu** (in-app hidden admin menu reorganized into tabs: Overview, Toolbar, Pens & input, Display & saver, Boards, Backup & updates, Diagnostics) — **same settings as before, nothing added/removed**, constant panel size across tabs.
- **Select / Undo / Redo** on one toolbar row (Select left, Undo middle, Redo right). Toolbar tool buttons render in rows of 3 (`pat=[3,3,3]`). Select was added to the toolbar (TBD/TI/ADL) and removed from the Tools flyout.
- **Smoother pen/laser:** laser glow lightened (shadowBlur 6) + ~30fps throttle (fixed school lag); pen/marker/dotted capture coalesced pointer events.
- **Fullscreen on first touch** (web best-effort; true no-system-bars needs the APK — see §10).
- **Hold-to-open radial quick menu:** press & hold the pen for 2s on the board → a ring blooms at that point. Current options: **Colour** (ring of swatches), **Size** (slider with a live dot preview), **Clear** (clears page), **Pen** (type: Pen/Marker/Dotted). Slide to an option then a sub-choice, lift to apply, lift elsewhere to cancel. Focusing an option hides the others until you slide back to the centre. Hold tolerates ~24px of shake. Disabled in presentation mode. Only pen/marker/dotted/laser arm it. (The **Toolbar** option was **removed** at user request.)
- **Pen menu:** pen type buttons have icons; size slider shows a small live dot preview (cap 24px).
- **Duplicate page** in the Pages menu.
- **Scheduled welcome / goodbye screens:** full-screen overlay shown at the scheduled time; message supports `{board.ID}` which is replaced by the board's own name (`bsName()`); one global schedule for all boards, set from the panel (see §5), stored in `wbWG`, applied via `raAct('wg', ...)`, shown once per day per type, auto-dismiss ~9s or on tap.
- **Scheduled page clear** toast now says **"Cleared pages"** (was "Board cleared for the next class").

---

## 7. Removed / rejected — DO NOT re-add unless asked

- **Fun menu** (noise meter, group maker, scoreboard, sound-effects board, confetti, tic-tac-toe, hangman) — was built, shipped, then **removed** at user request. Don't bring it back.
- **Password-protected admin-key backup** — removed.
- **Class mascot** (reactive owl) — concept mockup only, **rejected**, never built.
- **Daily welcome-page designs** (earlier generic/calendar/sunrise/note-card concepts) — rejected. (This is different from the current scheduled welcome/goodbye screens, which ARE built.)
- The radial menu's **Toolbar/moon** option — removed.

---

## 8. Features requested but NOT yet implemented (planned — build these next)

1. **Presentation mode** (Tools → Presentation). Two ways in: **from this device** and **from phone (QR/link)**. **Must open PPT (.pptx) only.** Opens the deck full-screen; **only a black pen works**; **no toolbar, no UI, nothing else** — just the pen. Exit via a **faint ✕ top-right** (faint enough to tell it's there). Technical reality to solve: browsers can't render `.pptx` natively; needs a client-side renderer (loads online) or conversion to images. Build the viewer + black-pen overlay + faint exit regardless; wire the best pptx renderer and degrade gracefully.
2. **Device whitelist / approval** (managed in the admin panel): you see a board's **Name/ID** and grant it access. **Without access the board shows only the Zhyar logo and nothing works.** User chose **STRICT**: boards are locked until approved. **BRICK WARNING:** the moment this ships, every board shows only the logo until approved; the board with the broken updater can't even receive it. Build it with: the lock screen shows that board's **ID**, and the panel has an **"approve all boards seen recently"** button so the whole fleet can be cleared in one tap. **Give the user one clear heads-up before deploying this.**
3. **"Approved Devices" notifications** — notify in the panel when a device is added to / removed from the whitelist.
4. **Maintenance mode** — completely stop a board: it shows only the Zhyar logo, nothing works. (Same brick caution as the whitelist.)
5. **Admin activity history** — DONE in the panel (see §5). (Listed here because it was part of the original big request; it is already implemented.)
6. **Per-board maintenance notes** — DONE in the panel (see §5).
7. **Offline update packages** — in the **on-board admin menu**, import an update package file from the device to update without internet. Constraint: on the user's WebView APK, replacing the running app from a local file has the same limitation as online updates (no active service worker) — explain what's actually possible.
8. **Scheduled welcome/goodbye screens** — DONE (board + panel, one global schedule). (Was originally "don't add"; the user then asked to build it with the panel control, which is done.)

Note: items 5, 6, 8 above are already implemented and are listed only because they were part of the same original multi-feature request; everything else in this section is still pending.

---

## 9. Known bugs / constraints / things still to fix

- **Service worker doesn't run in the user's WebView APK.** The app registers `sw.js`, but the APK's WebView doesn't run service workers, so `navigator.serviceWorker.controller` stays null → the in-app updater used to fail with **"offline worker is not active"**. Mitigation shipped: `upInstall` now has a **live-reload fallback** (when online and no worker/bridge, it reloads the live site with a cache-busting query to pull the new build). `sw.js` was added for boards that *can* run it.
  - **A board stuck on an old build can't self-update** (its old code can't install). Recovery: on strong internet, **clear the app's cache** (Android: Settings → Apps → ZHSE-A → Storage → Clear cache) or reinstall the APK, which forces a fresh fetch of the current build. After it's on a build with the fallback, it self-updates.
- **True offline + no-system-bars (immersive) must be handled in the APK**, not the web code:
  - For guaranteed offline start, the APK should bundle the files **or** enable `ServiceWorkerController` so `sw.js` runs.
  - For no taskbar/status/nav bars, add to the Activity (and re-apply in `onWindowFocusChanged`):
    ```kotlin
    WindowCompat.setDecorFitsSystemWindows(window, false)
    val c = WindowInsetsControllerCompat(window, window.decorView)
    c.hide(WindowInsetsCompat.Type.systemBars())
    c.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    ```
- **Works offline today:** drawing, pages, undo/redo, the quick menu, GeoGebra offline graph, PDFs after one online open (pdf.js caches in `caches['pdfjs-v1']`), saved work (localStorage). **Needs internet by nature:** phone/QR transfer, AI neat writing.
- GitHub Pages deploys have at times been slow (runs queued) — rollouts can lag a few minutes; not a code issue.

---

## 10. External libraries / dependencies loaded at runtime
- GeoGebra: `https://www.geogebra.org/apps/deployggb.js` (online only; falls back to the built-in offline graph).
- pdf.js 3.11.174 from cdnjs (cached after first online load).
- qrcode-generator 1.4.4 from cdnjs (phone transfer QR; needs internet).
- AI writing fonts (Caveat / Aref Ruqaa Ink / Noto Naskh Arabic) from Google Fonts (optional; falls back to system).

---

## 11. Testing method (do this for every change)
- Headless Playwright (`playwright` + bundled Chromium are preinstalled). Serve the file from a tiny local Node http server on `127.0.0.1` and `page.goto` it (localStorage/service-worker need an http origin, not `setContent`).
- Route/abort cross-origin requests so external CDNs don't hang the test.
- On load the app shows a **splash `#spl`** and sometimes a **lock `#lk`**; hide them (`display='none'`) before interacting with the canvas.
- There are **5 canvases**; the whiteboard is `WB.cv` (global). The app script and the admin panel script keep most internals **private** (not on `window`) — test through the **DOM and real events**, not by calling internal functions. `window.funOpen`/`window.presOpen`/`window.__rqOpen` style hooks are only exposed where explicitly added.
- Count strokes via `P.reduce((n,q)=>n+q.s.length,0)` only where `P` is reachable; otherwise assert via DOM.
- Always capture `pageerror`; a benign "EventSource MIME" console error appears when the test server stubs the relay — ignore that one.

## 12. Git / environment notes
- `origin` prints a "repository moved … ZHSE-alaz.git" redirect notice on push — **harmless**, the push still succeeds. Filter it when reading output.
- Branch `main`. Keep the working tree clean; move mockup files out of the repo after publishing.

---

## 13. Exact next steps (in order)
1. **Presentation mode (PPT-only)** — build the full-screen viewer, black-pen-only drawing, faint ✕ exit, device + phone(QR) entry; wire a pptx renderer with graceful fallback. Test the frame headless; tell the user to test a real deck. Then `force update` on his word.
2. **Offline update packages** (on-board admin menu) — import a package from the device; explain the WebView limitation.
3. **Device whitelist (STRICT) + "Approved Devices" notifications**, then **Maintenance mode** — build last, with the lock screen showing the board ID and a panel "approve all boards seen recently" button. **Warn the user once before deploying**, because it locks the whole fleet until approved.

Always: build → test → commit locally → wait for `force update`/`push` → bump build (+version.json) → push.
