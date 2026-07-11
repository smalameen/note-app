# note-app

## Quick start

```sh
# Requires valid .env (SUPABASE_URL, SUPABASE_KEY)
node server.js          # starts on http://localhost:3000
```

## Project structure

- `server.js` — Express 5 API (CommonJS), single entrypoint
- `public/index.html` — SPA with Quill.js editor; all frontend JS inline
- `.env` — `SUPABASE_URL` and `SUPABASE_KEY` required at runtime

## Key facts

- Supabase table is `notesupdated` (not `notes`) — used in all CRUD queries
- PUT `/api/notes/:id` only updates `title` and `content`; `parent_id` and `is_folder` are intentionally excluded from updates
- The `.env` file currently contains placeholder values; real Supabase credentials needed to run
- `npm test` is a no-op placeholder (`echo "Error: no test specified"`); no test framework exists
- No linter, formatter, or typechecker configured

## 2026-07-12 improvements

### Backend (`server.js`)
- **Input validation** — POST validates `title` (required, string, non-empty), `is_folder` (boolean), `parent_id` (number|null); PUT validates `title` non-empty
- **Error handling middleware** — catches unhandled async errors instead of crashing
- **Delete cascade protection** — `DELETE /api/notes/:id` rejects with 409 if folder has children
- **Health endpoint** — `GET /api/health` returns `{ status, timestamp }`
- **Request logging** — added `morgan('dev')` middleware
- **Env validation** — server exits at startup if `SUPABASE_URL`/`SUPABASE_KEY` are missing
- **Body limit** — JSON body limited to 10mb

### Frontend (`public/index.html`)
- **Modal system** — replaced `prompt()` calls with a reusable modal dialog for creating notes/folders and inserting tables
- **Empty state** — shows friendly message when no notes exist
- **Loading spinner** — shown while fetching notes
- **Error states** — toast notifications for success/error feedback on create, save, delete
- **Unsaved-changes guard** — confirms before switching notes with unsaved changes; warns on page close via `beforeunload`
- **Theme persistence** — light/dark theme saved to `localStorage`
- **Keyboard shortcuts** — `Ctrl+S` / `Cmd+S` saves, `Ctrl+N` / `Cmd+N` creates a new note
- **Dead button removed** — settings `⚙️` button removed from footer
- **Save button** — always-visible Save button in editor topbar for manual saves
- **XSS protection** — titles escaped via `textContent` before rendering in tree
- **Google Docs-style toolbar** — grouped formatting tools with separators (B/I/U/S, color/highlight, headings, lists, alignment, link, table grid, clear)
- **Table grid picker** — visual 8×8 hover-to-select grid popup for table insertion (no more modals)
- **Enter key** — pressing Enter in title input saves the note; modal Enter/Escape handlers with `stopPropagation` and `preventDefault`
- **No separate title input** — editor is full-bleed; title auto-derived from first line of content
- **Font size controls** — A–/A+ buttons to increase/decrease font size; dropdown with 11px–36px range; default 16px
- **Resizable sidebar** — drag handle between sidebar and editor; range 180px–500px
- **Inline rename** — double-click any note/folder title in the tree to edit inline; saves on Enter/blur

## App entrypoints

| Layer | File | Notes |
|-------|------|-------|
| Backend | `server.js` | Express app, mounts `/api/notes` routes |
| Frontend | `public/index.html` | Single HTML file, Quill CDN, all logic inline |
| Database | Supabase (`notesupdated` table) | `id`, `title`, `content`, `is_folder`, `parent_id`, `created_at` |
