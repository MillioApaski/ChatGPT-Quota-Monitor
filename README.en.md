# ChatGPT Quota Monitor

English | [简体中文](./README.md)

A lightweight, dependency-free **Tampermonkey userscript** showing **ChatGPT Work / Codex shared usage allowances** in a floating panel at chatgpt.com. It displays remaining 5-hour and weekly percentages (when provided), reset countdowns, and synchronization status.

> **Disclaimer:** Unofficial community project, not affiliated with OpenAI. It uses an **undocumented internal endpoint** that may change without notice. For authoritative numbers, use **ChatGPT Settings → Usage**.

## Features

- Classifies 5-hour and weekly windows by actual duration, regardless of the order of primary/secondary fields.
- Displays the remaining percentage reported by the service; does not guess from the number of messages.
- Updates countdown timers locally every second, and refreshes usage roughly every 60 seconds while visible.
- Draggable, collapsible widget with dark/light theme support and local layout preferences.
- Manual refresh, timeout/error handling, and clear messages when a window is unavailable.
- Tampermonkey automatic updates through this repository.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) and allow userscripts on chatgpt.com.
2. [**Install this userscript**](https://raw.githubusercontent.com/MillioApaski/ChatGPT-Quota-Monitor/main/chatgpt-quota-monitor.user.js).
3. Reload https://chatgpt.com/ and find the widget in the bottom-right corner.
4. Drag the header to move it, click **−** to collapse or **↻** to refresh.

## Data source and privacy

The script only calls two same-origin endpoints on chatgpt.com:

- `/api/auth/session`: reads the current session's access token **in memory only**; never persists it.
- `/backend-api/wham/usage`: obtains usage percentages and reset timestamps.

There is no telemetry, tracking, external dependency, or third-party request. Only the panel's position and collapsed state are saved in localStorage.

**Not every account has a 5-hour limit.** Missing or unrecognized windows display as unavailable, not as 0% remaining. The private API may change at any time.

## Troubleshooting

- **Window unavailable**: The service did not report a recognizable window. Consult Settings → Usage.
- **401 / 403**: The session may be expired, or the endpoint may be blocked for this account. Sign in again and refresh.
- **Widget missing**: Check Tampermonkey permissions and whether the userscript is enabled.
- **Different usage figures**: The official Usage page takes precedence.

Never post access tokens, cookies, email addresses or other private account information in bug reports.

## Development

Requires Node.js 20+ for testing. No runtime dependencies or build step.

```bash
npm test
```

GitHub Actions validates syntax, quota parsing, and userscript metadata. To publish a release, update the version in both the userscript and package.json, then push a `vX.Y.Z` tag. Releases attach the userscript file; Tampermonkey checks the raw file on main for updates.

## License and AI notice

[MIT](./LICENSE). Code and documentation were assisted by OpenAI ChatGPT (GPT-6). Behavior on a signed-in browser session still requires live validation.
