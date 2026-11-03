# ChatGPT Quota Monitor

English | [简体中文](./README.md)

A lightweight, dependency-free **Tampermonkey userscript** that adds a desktop-inspired **usage card above the account button in the left sidebar** of regular ChatGPT web chats. In **Work** conversations, it keeps the existing **Output / Sources** quota section on the right. Both views use the same Work/Codex usage data.

> **Disclaimer:** Unofficial community project, not affiliated with OpenAI. It uses an **undocumented internal endpoint** that may change without notice. For authoritative numbers, use **ChatGPT Settings → Usage**.

## Features

- Classifies 5-hour and weekly windows by actual duration, regardless of the order of primary/secondary fields.
- Displays the remaining percentage reported by the service; does not guess from the number of messages.
- Updates countdown timers locally every second, and refreshes usage roughly every 60 seconds while visible.
- Desktop-style card in the expanded web sidebar: plan source, 5-hour and weekly limits, optional credits, and a Manage usage link.
- Existing collapsible Work Output / Sources quota section stays on the right, including progress bars and reset countdowns.
- Only one placement is active at a time; no duplicate API polling. Hidden if the sidebar is collapsed or narrow.
- Manual refresh, timeout/error handling, and clear messages when a window is unavailable.
- Tampermonkey automatic updates through this repository.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) and allow userscripts on chatgpt.com.
2. [**Install this userscript**](https://raw.githubusercontent.com/MillioApaski/ChatGPT-Quota-Monitor/main/chatgpt-quota-monitor.user.js).
3. Reload a **regular ChatGPT web chat** at https://chatgpt.com/ and expand the left sidebar. The quota card appears above the profile button.
4. In **Work**, the meter instead appears in the upper-right Output / Sources panel. Click **−** to collapse the Work section or **↻** to refresh either view.

## Data source and privacy

The script only calls two same-origin endpoints on chatgpt.com:

- `/api/auth/session`: reads the current session's access token **in memory only**; never persists it.
- `/backend-api/wham/usage`: obtains usage percentages, reset timestamps, and optional credits fields.

There is no telemetry, tracking, external dependency, or third-party request. Only the Work quota section's collapsed state is saved in localStorage.

**The percentages refer to shared Work/Codex usage, not ordinary chat message limits.** Not every account has a 5-hour limit. Missing windows or credit balances display as unavailable, not zero. Explicit `credits.has_credits: false` is treated as no extra credits. The private API may change at any time.

## Troubleshooting

- **Window unavailable**: The service did not report a recognizable window. Consult Settings → Usage.
- **401 / 403**: The session may be expired, or the endpoint may be blocked for this account. Sign in again and refresh.
- **Widget missing**: Check Tampermonkey permissions. Normal chats require an **expanded desktop-width left sidebar**; Work requires its upper-right Output / Sources panel. UI changes can affect injection.
- **Different usage figures**: The official Usage page takes precedence.

Never post access tokens, cookies, email addresses or other private account information in bug reports.

## Development

Requires Node.js 20+ for testing. No runtime dependencies or build step.

```bash
npm test
```

GitHub Actions validates syntax, quota parsing, and userscript metadata. To publish a release, update the version in both the userscript and package.json, then push a `vX.Y.Z` tag. Releases attach the userscript file; Tampermonkey checks the raw file on main for updates.

## Work UI compatibility

The script recognizes Work from its Output / Sources headings and geometry, then inserts into the right card. Otherwise, it looks for the expanded sidebar profile button (with a footer fallback) and inserts a card above it. These are not public DOM contracts and may change without notice. No fixed-position overlays are used. Live browser validation is still required for the new sidebar layout.

## License and AI notice

[MIT](./LICENSE). Code and documentation were assisted by OpenAI ChatGPT (GPT-6). Behavior on a signed-in browser session still requires live validation.
