# AI Code Review Workflow & Standards
<!-- Inspired by Anthropic's Engineering System for Claude Code -->

This repository enforces an automated, low-revert AI code review protocol for all AI agents (Claude Code, Hermes Agent, subagents).

## Core Principles

1. **Proof of Work (No blind claims)**:
   - An agent cannot declare a task complete without tangible proof: execution logs, passing test results, or clean build verification.
   - Code without proof is considered incomplete.

2. **Fresh-Context Diff Review**:
   - The agent writing code has confirmation bias and poisoned context.
   - Self-review must occur in a fresh context or subagent looking strictly at `git diff` against `main` and `REVIEW.md`.

3. **Living `REVIEW.md`**:
   - `REVIEW.md` contains repo-specific guardrails, architectural red lines, and hard rules.
   - **Promotion Rule**: Any recurring bug, style correction, or review remark that happens 2+ times MUST be added as a 1-line rule to `REVIEW.md`.

4. **Automated Local Scans**:
   - Run local linting, static checks, and security scans before proposing changes.

5. **Risk-Tiered Gates**:
   - **Low Risk** (Docs, UI tweaks, feature-flagged logic): Fast-track / minimal review.
   - **Medium Risk** (Core logic, API endpoints): Requires 1 fresh-context review + passing tests.
   - **High Risk** (Auth, cryptographic keys, payment, DB schema migrations): Requires dual review + manual human sign-off.

6. **3-Round Pivot & Rapid Rollback**:
   - If an AI agent cannot resolve an issue or test failure within 3 iterations, stop cycling. Discard context (`git reset`), pivot the architectural approach, and re-prompt.
   - Keep new capabilities behind feature flags for fast rollback.
