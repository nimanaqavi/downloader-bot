# Repository Review Rules & Guardrails
<!-- Checked by agents before coding and during diff review. Living document. -->

## Strict Guardrails (Mimo Downloader Bot)
- **RAM / VPS Budget (256 MB limit)**:
  - Never buffer whole downloads/media into RAM; stream directly to disk or destination.
  - Always clean up temp files in `finally` blocks or error handlers immediately.
  - SQLite: Keep `cache_size` capped (-2000 / ~2MB) and WAL mode enabled.
  - Concurrency: Limit upload/download workers (e.g. GramJS max 2 workers, 1 active task per user).
- **Security & Network**:
  - Enforce SSRF validation on all user URLs before requesting.
  - Never interpolate unescaped strings into shell commands — use argument arrays.
  - Sanitize all log output: strip Telegram bot tokens and absolute file paths.
- **Reliability & Errors**:
  - Always generate or propagate tracking error IDs (`ERR-XXXXXX`).
  - No silent exception swallowing (`catch (e) {}` with no logging or recovery).

## Living Rules (Promoted from repeated review feedback)
<!-- Add recurring corrections below as a single bullet point -->
