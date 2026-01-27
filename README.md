# Universal Agent Quota

Monitor quota for AI CLI tools in VS Code with a sidebar panel and status bar.

## Supported Providers

| Provider | Auth Method | Credential Location |
|----------|-------------|---------------------|
| **Antigravity** | OAuth (Google) | `~/.config/opencode/antigravity-accounts.json` |
| **Claude Code** | OAuth | macOS Keychain or `~/.claude/.credentials.json` |
| **Codex CLI** | OAuth + API Key | `~/.codex/auth.json` or `OPENAI_API_KEY` |
| **Gemini CLI** | OAuth 2.0 | `~/.gemini/oauth_creds.json` |
| **Z.AI** | API Key | VS Code Settings or `$ZAI_API_KEY` |

## Features

- **Sidebar Panel**: Hierarchical view of all providers, accounts, and models
- **Status Bar**: Quick glance at quota across all providers
- **Auto-Refresh**: Updates every 5 minutes (configurable)
- **Notifications**: Alerts when quota drops below threshold
- **Multi-Account**: Full support for Antigravity multi-account setup

## Visual Indicators

| Icon | Meaning |
|------|---------|
| 🟢 | Good (>=70% remaining) |
| 🟡 | Warning (30-69% remaining) |
| 🔴 | Critical (<30% remaining) |
| ⚫ | Not configured |

## Commands

- `Universal Quota: Refresh Quota` - Manually refresh quota data
- `Universal Quota: Show Quota Details` - Open the sidebar panel
- `Universal Quota: Configure Settings` - Open extension settings

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `universalQuota.refreshInterval` | 300000 | Auto-refresh interval in ms (5 min) |
| `universalQuota.notifications.enabled` | true | Enable low quota notifications |
| `universalQuota.notifications.warningThreshold` | 20 | Warning at this % remaining |
| `universalQuota.notifications.criticalThreshold` | 5 | Critical warning at this % |
| `universalQuota.providers.zai.apiKey` | `""` | Z.AI (Zhipu/GLM) API Key (supersedes env vars) |

## Requirements

Each provider reads credentials from its respective CLI tool:

- **Antigravity**: `opencode auth login`
- **Claude Code**: Run `claude` to authenticate
- **Codex CLI**: `codex login`
- **Gemini CLI**: Run `gemini` to authenticate
- **Z.AI**: Set `universalQuota.providers.zai.apiKey` in settings or `ZAI_API_KEY` environment variable

## License

MIT
