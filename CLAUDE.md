# Agent Operating Protocol (Claude Code & Hermes)

## Mandates
1. **Pre-Flight**: Read `OVERVIEW.md` and `REVIEW.md` before generating or modifying code.
2. **Execution Proof**: Never conclude a task without executing real verification (e.g. `npm test`, `go test`, build scripts, or manual CLI validation). Output must be shown.
3. **Session Review**:
   - Inspect `git diff` before committing or declaring work complete.
   - Verify every diff against `REVIEW.md` rules.
4. **Living Knowledge Loop**:
   - If a human reviewer or test catches an error that occurred previously, append a concise 1-line rule to `REVIEW.md` under `Living Rules`.
5. **3-Round Ceiling**: If an issue remains unresolved after 3 attempts, reset changes and prompt for a different strategy.
