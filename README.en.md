# ChatGPT Quota Monitor

English | [简体中文](./README.md)

A lightweight, dependency-free **Tampermonkey userscript** adding a native-sized **Quota sidebar row with a live two-arc ring icon** above the account entry in regular ChatGPT web chats. Click it to open the desktop-inspired quota popup; it is hidden by default. In **Work** conversations, the existing **Output / Sources** meter stays on the right. Both use the same Work/Codex usage data.

> **Disclaimer:** Unofficial community project, not affiliated with OpenAI. It uses an **undocumented internal endpoint** that may change without notice. For authoritative numbers, use **ChatGPT Settings → Usage**.

## Features

- Classifies 5-hour and weekly windows by actual duration, regardless of the order of primary/secondary fields.
- Displays the remaining percentage reported by the service; does not guess from the number of messages.
- Updates countdown timers locally every second, and refreshes usage roughly every 60 seconds while visible.
- Desktop-style quota icon: the short upper arc tracks remaining 5-hour allowance; the long lower arc tracks remaining weekly allowance. Both are true SVG circular arcs sharing the same center and radius. A contrasting amber segment shows consumed allowance; e.g. 92% remaining is 8% consumed, 99% remaining is 1% consumed. If no 5-hour window exists, the weekly progress uses a complete ring. Unknown data is never displayed as 0 or 100%.
- Click-to-open popup: a native-sized **Quota** sidebar row independently aligns its smaller progress ring to the avatar center and its label to the username start using measured absolute offsets. Click to show plan source, 5-hour and weekly limits, optional credits, and a Manage usage link.
- Click the icon again, click outside, or press Escape to close. Popup stays within viewport and is removed when closed.
- Existing collapsible Work Output / Sources quota section stays on the right, including progress bars and reset countdowns.
- Only one placement is active at a time; no duplicate API polling. Hidden if the sidebar is collapsed or narrow.
- Manual refresh, timeout/error handling, and clear messages when a window is unavailable.
- Tampermonkey automatic updates through this repository.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) and allow userscripts on chatgpt.com.
2. [**Install this userscript**](https://raw.githubusercontent.com/MillioApaski/ChatGPT-Quota-Monitor/main/chatgpt-quota-monitor.user.js).
3. Reload a **regular ChatGPT web chat** at https://chatgpt.com/ and expand the sidebar. A Quota row with live progress rings appears above the profile button.
4. Click the icon to show the popup. Click outside or press **Esc** to dismiss it. In **Work**, the meter stays in the upper-right Output / Sources panel.

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

The script recognizes Work from its Output / Sources headings and geometry. Otherwise, it looks for the expanded sidebar profile button (with a footer fallback) and inserts only a trigger button above it. The popup is portaled to document.body on demand and opens beside the full sidebar to avoid clipping or covering the account menu, then is dismissed on navigation/Work transitions. These are not public DOM contracts and may change without notice. Live browser validation is still required.

## License and AI notice

[MIT](./LICENSE). Code and documentation were assisted by OpenAI ChatGPT (GPT-6). Behavior on a signed-in browser session still requires live validation.

### v1.3.1 bug fix

The popover contents are rendered inside a separate Shadow DOM. Previously the data-binding code accidentally looked up four elements in the original Shadow DOM, throwing during initial render and preventing the first usage fetch. All five popup nodes now resolve through `popupShadow`, with a dedicated regression test. Sidebar alignment now follows the real profile button geometry instead of a fixed inset.

### v1.3.2 visual alignment

The upper and lower quota indicators now use exact circular SVG arcs, not multi-segment paths. The button measures the real avatar and first username text position when mounted, aligning both icon center and label without guessing a CSS left offset. Static geometry and layout regression tests cover these placements. The site is unofficial and OpenAI can change its DOM at any time.

### v1.3.3 indicator refinement

The sidebar ring now explicitly draws used allowance in amber on top of the gray/remaining tracks. Used segments remain proportional rather than exaggerating low usage. The SVG is reduced to fit the avatar, while the icon center and text start are measured and positioned independently. Tests exercise the 92%/99% remaining example and missing quota windows.
