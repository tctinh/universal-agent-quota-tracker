# Change Log

All notable changes to the "Universal Agent Quota" extension will be documented in this file.

## [0.1.6] - 2026-01-27

### Fixed
- Gemini CLI token refresh now retries on 401/403 authentication errors
- Treats missing or invalid `expiry_date` as expired, triggering refresh before first API call

### Added
- GLM (Zhipu) API key configuration via VSCode settings (`universalQuota.providers.zai.apiKey`)
- Settings-based API keys take precedence over environment variables and stored secrets

### Changed
- Updated documentation to reflect new GLM key configuration method

## [0.1.4] - 2026-01-19

### Improved
- Antigravity storage path detection (supports both `.config` and `.local/share`)
- Antigravity project ID handling (prefers configured IDs, improved extraction)
- Antigravity model matching (case-insensitive, includes display name)
- Handling of reset times and quota percentages for Antigravity

## [0.1.3] - 2026-01-11

### Fixed
- Improved Antigravity quota retrieval to match reference implementation
- Fixed model grouping for Antigravity: Gemini 3 Pro, Gemini 3 Flash, Gemini 3 Image, Claude/GPT

### Added
- Display subscription tier (FREE/PRO/ULTRA) for Antigravity accounts
- 403 Forbidden status indicator for Antigravity accounts

## [0.1.2] - 2026-01-11

### Changed
- Renamed extension to Universal Agent Quota Tracker

## [0.1.1] - 2026-01-11

### Added
- Support for detailed Z.AI quota tracking

## [0.1.0] - 2026-01-06

### Added
- Initial release
- Support for 5 AI CLI quota providers:
  - Antigravity (multi-account support)
  - Claude Code
  - Codex CLI (OpenAI)
  - Gemini CLI
  - Z.AI
- Sidebar TreeView with hierarchical display (Provider > Account > Model)
- Status bar with aggregated quota summary
- Auto-refresh every 5 minutes (configurable)
- Manual refresh command
- Low quota notifications with configurable thresholds
- Visual health indicators (color-coded icons)
- Reset time display for each model
