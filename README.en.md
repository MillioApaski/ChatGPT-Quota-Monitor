# ChatGPT Quota Monitor

English | [简体中文](./README.md)

A lightweight, dependency-free **Tampermonkey userscript** showing **ChatGPT Work / Codex shared usage allowances** inside the upper-right **Output / Sources** panel of **ChatGPT Work** sessions only. It displays remaining 5-hour and weekly percentages (when provided), reset countdowns, and synchronization status.

> **Disclaimer:** Unofficial community project, not affiliated with OpenAI. It uses an **undocumented internal endpoint** that may change without notice. For authoritative numbers, use **ChatGPT Settings → Usage**.

## Features

- Classifies 5-hour and weekly windows by actual duration, regardless of the order of primary/secondary fields.
- Displays the remaining percentage reported by the service; does not guess from the number of messages.
- Updates countdown timers locally every second, and refreshes usage roughly every 60 seconds while visible.
- Embedded as a collapsible section of the Work Output / Sources card, with dark/light theme support.
- Hidden entirely in regular ChatGPT conversations, including no quota polling outside Work.
- Manual refresh, timeout/error handling, and clear messages when a window is unavailable.
- Tampermonkey automatic updates through this repository.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) and allow userscripts on chatgpt.com.
2. [**Install this userscript**](https://raw.githubusercontent.com/MillioApaski/ChatGPT-Quota-Monitor/main/chatgpt-quota-monitor.user.js).
3. Open a **ChatGPT Work** conversation at https://chatgpt.com/, then find the quota section in the upper-right Output / Sources card.
4. Click **−** to collapse or **↻** to refresh. Regular chats do not show the section.

## Data source and privacy

The script only calls two same-origin endpoints on chatgpt.com:

- `/api/auth/session`: reads the current session's access token **in memory only**; never persists it.
- `/backend-api/wham/usage`: obtains usage percentages and reset timestamps.

There is no telemetry, tracking, external dependency, or third-party request. Only the collapsed state is saved in localStorage.

**Not every account has a 5-hour limit.** Missing or unrecognized windows display as unavailable, not as 0% remaining. The private API may change at any time.

## Troubleshooting

- **Window unavailable**: The service did not report a recognizable window. Consult Settings → Usage.
- **401 / 403**: The session may be expired, or the endpoint may be blocked for this account. Sign in again and refresh.
- **Widget missing**: Check Tampermonkey permissions and whether the userscript is enabled. It displays only when the upper-right Work Output / Sources panel is available. OpenAI UI changes may affect detection.
- **Different usage figures**: The official Usage page takes precedence.

Never post access tokens, cookies, email addresses or other private account information in bug reports.

## Development

Requires Node.js 20+ for testing. No runtime dependencies or build step.

```bash
npm test
```

GitHub Actions validates syntax, quota parsing, and userscript metadata. To publish a release, update the version in both the userscript and package.json, then push a `vX.Y.Z` tag. Releases attach the userscript file; Tampermonkey checks the raw file on main for updates.

## Work UI compatibility

The script detects the Work-only side card from its Output / Sources headings and right-side geometry. This is not a public DOM contract. If the card is absent, hidden, renamed, or redesigned, the quota section will remain hidden rather than reverting to a floating overlay or showing in regular chat. Browser validation in an authenticated Work session is still required.

## License and AI notice

[MIT](./LICENSE). Code and documentation were assisted by OpenAI ChatGPT (GPT-6). Behavior on a signed-in browser session still requires live validation.
