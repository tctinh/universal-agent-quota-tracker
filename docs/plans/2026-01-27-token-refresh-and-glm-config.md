# Token Refresh and GLM Config Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use hive_skill:executing-plans to implement this plan task-by-task.

**Goal:** Ensure Gemini CLI tokens auto-refresh and add a VSCode settings-based GLM/Zhipu API key path (preferred over env) for quota checks.

**Architecture:** Keep provider logic in `src/providers/*` and wire config in the extension layer. Use a settings-backed API key to populate the existing Z.AI provider (GLM) so it no longer depends on environment variables.

**Tech Stack:** VS Code extension (TypeScript), existing provider registry, SecretStorage (already used), settings via `package.json`.

---

## Discovery

**Q: When the Gemini CLI token expires, should we auto-refresh transparently or log/prompt?**
A: Auto-refresh silently (only surface errors if refresh fails).

**Q: Which GLM provider is intended for the VSCode key?**
A: Zhipu AI/ChatGLM direct API.

**Research:**
- Gemini CLI provider in `src/providers/gemini-cli.ts`: refreshes token on expiry; uses `loadCodeAssist` + `retrieveUserQuota` to fetch quota.
- Z.AI provider in `src/providers/zai.ts`: supports in-memory key via `setZaiApiKey` and falls back to env vars.
- Config and commands live in `package.json`, API key prompting in `src/services/apiKeyService.ts`, extension wiring in `src/extension.ts`.

## Non-Goals
- Adding new provider UIs beyond settings (no new views).
- Changing Z.AI quota API semantics or model parsing.
- Implementing Gemini API-key quota retrieval (not available from Gemini API key mode).

## Ghost Diffs
- Use SecretStorage-only for GLM key (rejected: user explicitly wants VSCode config input).
- Add a new “GLM” provider separate from Z.AI (rejected: existing Z.AI provider already targets Zhipu/GLM).
- Prompt users on every Gemini refresh (rejected: user wants silent refresh).

---

### 1. Gemini CLI refresh robustness

**Files:**
- Modify: `src/providers/gemini-cli.ts`

**Step 1: Add a refresh-on-auth-error retry path**
- On failures of `getProjectId` or `getQuota` due to 401/403, attempt a single token refresh and retry once.
- Keep refresh silent; only return `auth_expired` if refresh fails.

**Step 2: Guard expiry checks**
- Treat missing/invalid `expiry_date` as expired and attempt refresh before first API call.

**Step 3: Manual verification (Gemini refresh path)**
- Temporarily invalidate `access_token` in `~/.gemini/oauth_creds.json` (e.g., replace with garbage or set expired `expiry_date`), then trigger quota fetch to confirm refresh+retry succeeds.

**Step 4: Run typecheck**
Run: `npm run compile`
Expected: success, no TS errors.

**Step 5: Commit**
```bash
git add src/providers/gemini-cli.ts
git commit -m "fix: refresh gemini cli tokens on auth failures"
```

---

### 2. GLM (Zhipu) API key via VSCode settings

**Files:**
- Modify: `package.json`
- Modify: `src/extension.ts`
- Modify: `src/providers/zai.ts`

**Step 1: Add settings schema**
- Add `universalQuota.providers.zai.apiKey` (string, default "") with description indicating Zhipu/GLM key.

**Step 2: Wire settings into provider**
- In `src/extension.ts`, read configuration on activation and call `setZaiApiKey`.
- Settings take precedence over SecretStorage: configuration value overwrites any stored key on activation/change.
- Add a `workspace.onDidChangeConfiguration` listener to update the key when settings change.

**Step 3: Prefer settings over env**
- In `src/providers/zai.ts`, keep `storedApiKey` as top priority; update hint for missing key to mention settings path.

**Step 4: Manual verification (settings live update)**
- Change `universalQuota.providers.zai.apiKey` while the extension is running and verify the provider uses the new key without reload.

**Step 5: Run typecheck**
Run: `npm run compile`
Expected: success, no TS errors.

**Step 6: Commit**
```bash
git add package.json src/extension.ts src/providers/zai.ts
git commit -m "feat: allow GLM key via VSCode settings"
```

---

### 3. Documentation refresh (optional but recommended)

**Files:**
- Modify: `README.md`

**Step 1: Add settings note**
- Document `universalQuota.providers.zai.apiKey` and clarify it supersedes env vars.

**Step 2: Commit**
```bash
git add README.md
git commit -m "docs: document GLM key setting"
```

---

## Verify
- `npm run compile`
- Manual: open settings, set `universalQuota.providers.zai.apiKey`, verify Z.AI quota loads without env vars; Gemini CLI refresh works when token expired.
