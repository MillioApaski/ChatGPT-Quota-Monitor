import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../chatgpt-quota-monitor.user.js', import.meta.url), 'utf8');
const start = source.indexOf('// BEGIN QUOTA_PARSER');
const end = source.indexOf('// END QUOTA_PARSER');
assert.ok(start >= 0 && end > start, 'quota parser markers must exist');
const { parseUsage } = runInNewContext(source.slice(start, end) + '\n({ parseUsage })', { Date });
const quota = (seconds, used, resetAt = 1_800_000_000) => ({
  limit_window_seconds: seconds, used_percent: used, reset_at: resetAt,
});
const payload = (primary, secondary) => ({
  plan_type: 'plus', rate_limit: { primary_window: primary, secondary_window: secondary },
});

test('recognizes windows independently of primary/secondary order', () => {
  const result = parseUsage(payload(quota(604800, 35), quota(18000, 20)));
  assert.equal(result.five.remaining, 80);
  assert.equal(result.week.remaining, 65);
  assert.equal(result.plan, 'plus');
});
test('handles weekly-only accounts', () => {
  const result = parseUsage(payload(quota(604800, 15), null));
  assert.equal(result.five, null);
  assert.equal(result.week.remaining, 85);
});
test('missing windows are not treated as exhausted', () => {
  const result = parseUsage(payload(null, null));
  assert.equal(result.five, null);
  assert.equal(result.week, null);
});
test('does not mislabel unknown one-hour windows', () => {
  const result = parseUsage(payload(quota(3600, 70), quota(604800, 40)));
  assert.equal(result.five, null);
  assert.equal(result.week.remaining, 60);
});
test('normalizes reset_at in seconds and milliseconds', () => {
  const sec = parseUsage(payload(quota(18000, 1, 1_800_000_000), null));
  const ms = parseUsage(payload(quota(18000, 1, 1_800_000_000_000), null));
  assert.equal(sec.five.resetAt, ms.five.resetAt);
});
test('handles relative reset time', () => {
  const before = Date.now();
  const result = parseUsage(payload({
    limit_window_seconds: 18000, used_percent: 20, reset_after_seconds: 100,
  }, null));
  assert.ok(result.five.resetAt >= before + 100000);
  assert.ok(result.five.resetAt <= Date.now() + 100000);
});
test('clamps percentages and skips malformed windows', () => {
  const r = parseUsage(payload(quota(18000, 170), quota(604800, -5)));
  assert.equal(r.five.remaining, 0);
  assert.equal(r.week.remaining, 100);
  assert.equal(parseUsage(payload({ limit_window_seconds: 18000, used_percent: 'broken' }, null)).five, null);
});
test('rejects malformed rate limit objects', () => {
  assert.throws(() => parseUsage({}), /rate_limit/);
  assert.throws(() => parseUsage({ rate_limit: [] }), /rate_limit/);
});
test('metadata matches package version and update URLs', () => {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(source.includes('@version      ' + version));
  assert.match(source, /@match\s+https:\/\/chatgpt\.com\/\*/);
  assert.match(source, /@grant\s+none/);
  const url = 'https://raw.githubusercontent.com/MillioApaski/ChatGPT-Quota-Monitor/main/chatgpt-quota-monitor.user.js';
  assert.ok(source.includes('@updateURL    ' + url));
  assert.ok(source.includes('@downloadURL  ' + url));
});


const panelBegin = source.indexOf('// BEGIN WORK_PANEL_PREDICATES');
const panelEnd = source.indexOf('// END WORK_PANEL_PREDICATES');
assert.ok(panelBegin >= 0 && panelEnd > panelBegin, 'Work panel predicates must exist');
const { isRightWorkPanelPair } = runInNewContext(
  source.slice(panelBegin, panelEnd) + '\n({ isRightWorkPanelPair })'
);
const header = (left, top) => ({ left, top, right: left + 48, width: 48, height: 24 });

test('recognizes Work Output and Sources headings in the right-side panel', () => {
  assert.equal(isRightWorkPanelPair(header(1415, 82), header(1415, 155), 1708, 896), true);
  assert.equal(isRightWorkPanelPair(header(1000, 82), header(1000, 155), 1280, 800), true);
});
test('rejects normal chat text and unrelated sidebar content', () => {
  assert.equal(isRightWorkPanelPair(header(500, 200), header(500, 270), 1708, 896), false);
  assert.equal(isRightWorkPanelPair(header(1415, 220), header(1415, 155), 1708, 896), false);
  assert.equal(isRightWorkPanelPair(header(1415, 82), header(1020, 155), 1708, 896), false);
  assert.equal(isRightWorkPanelPair(header(1415, 82), header(1415, 155), 600, 800), false);
});
test('mounts exactly one display in Work or expanded sidebar', () => {
  assert.match(source, /position:fixed/); // Portaled popup, never a permanent floating quota card.
  assert.match(source, /if \(!state\.popupOpen \|\| !popupRoot\.isConnected\) return;/);
  assert.doesNotMatch(source, /document\.documentElement\.append\(root\)/);
  assert.match(source, /workPanel \? null : locateSidebarInsertion\(\)/);
  assert.match(source, /if \(!workPanel && !sidebar\) \{ deactivate\(\); return; \}/);
  assert.match(source, /root\.dataset\.placement = placement/);
  assert.match(source, /if \(!state\.active \|\| document\.hidden \|\| state\.loading\) return;/);
  assert.match(source, /observer\.observe\(document\.body, \{ childList: true, subtree: true \}\)/);
});


test('quota section keeps native Work sidebar content gutters', () => {
  assert.match(source, /\.card\s*\{[^}]*padding:\s*12px 16px 14px/);
  assert.match(source, /border-top:\s*1px solid var\(--line\)/);
  assert.match(source, /\.body\s*\{\s*padding:\s*0;/);
});


const sidebarBegin = source.indexOf('// BEGIN SIDEBAR_PREDICATES');
const sidebarEnd = source.indexOf('// END SIDEBAR_PREDICATES');
assert.ok(sidebarBegin >= 0 && sidebarEnd > sidebarBegin, 'sidebar placement predicates must exist');
const { isExpandedSidebarProfile } = runInNewContext(
  source.slice(sidebarBegin, sidebarEnd) + '\n({ isExpandedSidebarProfile })'
);
const profile = (left, top, width = 245, height = 42) => ({
  left, top, width, height, right: left + width, bottom: top + height,
});

test('web expanded sidebar can mount quota card above account button', () => {
  assert.equal(isExpandedSidebarProfile(profile(50, 830), 1645, 896), true);
  assert.equal(isExpandedSidebarProfile(profile(16, 820, 260), 1708, 896), true);
});
test('collapsed rail, hidden sidebar or mobile viewport do not mount', () => {
  assert.equal(isExpandedSidebarProfile(profile(10, 835, 38, 38), 1645, 896), false);
  assert.equal(isExpandedSidebarProfile(profile(50, 830), 650, 896), false);
  assert.equal(isExpandedSidebarProfile(profile(800, 830), 1645, 896), false);
  assert.equal(isExpandedSidebarProfile(profile(50, 200), 1645, 896), false);
});
test('optional credits are shown only if account supplies an explicit value or no-credit flag', () => {
  const p = payload(quota(18000, 10), quota(604800, 20));
  assert.equal(parseUsage(p).credits, null);
  assert.equal(parseUsage({ ...p, credits: { balance: '2.50', has_credits: true } }).credits.balance, 2.5);
  assert.equal(parseUsage({ ...p, credits: { balance: 0, has_credits: false } }).credits.balance, 0);
  assert.equal(parseUsage({ ...p, credits: { has_credits: false } }).credits.balance, 0);
  assert.equal(parseUsage({ ...p, credits: { unlimited: true } }).credits.unlimited, true);
  assert.equal(parseUsage({ ...p, credits: { balance: 'nonsense', has_credits: true } }).credits, null);
});
test('sidebar imitates desktop plan/limits/credits/manage-usage layout', () => {
  assert.match(source, /id="sidebar-plan"/);
  assert.match(source, /id="sidebar-five"/);
  assert.match(source, /id="sidebar-week"/);
  assert.match(source, /id="sidebar-credits"/);
  assert.match(source, /href="\/settings\/usage"/);
  assert.match(source, /\[data-testid="accounts-profile-button"\]/);
  assert.match(source, /\[data-app-action-sidebar-scroll\]/);
  assert.match(source, /nodes\.sidebarCredits\.textContent = creditText/);
});

const popoverBegin = source.indexOf('// BEGIN POPOVER_POSITION');
const popoverEnd = source.indexOf('// END POPOVER_POSITION');
assert.ok(popoverBegin > 0 && popoverEnd > popoverBegin);
const { calculatePopoverPosition } = runInNewContext(
  source.slice(popoverBegin, popoverEnd) + '\n({ calculatePopoverPosition })'
);
test('quota popup is not shown until the button is clicked', () => {
  assert.match(source, /shadow\.append\(trigger\)/);
  assert.match(source, /nodes\.trigger\.addEventListener\('click'/);
  assert.match(source, /if \(state\.popupOpen\) \{ closePopup\(\); return; \}/);
  assert.match(source, /document\.body\.appendChild\(popupRoot\)/);
  assert.doesNotMatch(source, /shadow\.append\(sidebarCard\)/);
  assert.match(source, /popupShadow\.append\(css\.cloneNode\(true\), sidebarCard\)/);
  assert.match(source, /trigger\.setAttribute\('aria-expanded', 'false'\)/);
});
test('popup closes on outside pointer, Escape, and switching into Work', () => {
  assert.match(source, /event\.composedPath\(\)/);
  assert.match(source, /!path\.includes\(popupRoot\) && !path\.includes\(root\)/);
  assert.match(source, /event\.key === 'Escape' && state\.popupOpen/);
  assert.match(source, /if \(state\.mode && state\.mode !== placement\) closePopup\(\)/);
  assert.match(source, /function deactivate\(\) \{\s*closePopup\(\)/);
});
test('popover opens beside the full sidebar, never directly over its button', () => {
  const anchor = {left:40, right:76, top:804, bottom:840};
  const normal = calculatePopoverPosition(anchor, 260, 170, 1645, 896, 310);
  assert.equal(normal.left, 320);
  assert.equal(normal.top, 670);
  const narrow = calculatePopoverPosition({left:740,right:776,top:700,bottom:736},
    260,170,1050,896,780);
  assert.equal(narrow.left, 470);
  assert.equal(narrow.top, 566);
  const topEdge = calculatePopoverPosition({left:30,right:66,top:16,bottom:50},
    260,170,900,700,300);
  assert.equal(topEdge.left,310);
  assert.equal(topEdge.top,12);
  assert.match(source, /sidebarRightEdge\(anchor\)/);
});

const iconStart = source.indexOf('// BEGIN QUOTA_ICON_MODEL');
const iconEnd = source.indexOf('// END QUOTA_ICON_MODEL');
assert.ok(iconStart >= 0 && iconEnd > iconStart, 'icon model markers must exist');
const { quotaIconModel } = runInNewContext(
  source.slice(iconStart, iconEnd) + '\n({quotaIconModel})'
);
test('icon shows small 5-hour arc above large weekly arc, with real remaining percentages', () => {
  const model = quotaIconModel({remaining:85}, {remaining:33});
  assert.equal(model.layout, 'dual');
  assert.equal(model.fivePercent,85);
  assert.equal(model.weekPercent,33);
  assert.match(source, /id="quota-ring-five"/);
  assert.match(source, /id="quota-ring-week"/);
  assert.match(source, /setProgress\(nodes\.fiveRing, fivePercent\)/);
  assert.match(source, /setProgress\(nodes\.weekRing, weekPercent\)/);
});
test('no 5-hour window causes weekly quota to use one full circular ring', () => {
  const model = quotaIconModel(null, {remaining:72});
  assert.equal(model.layout,'single');
  assert.equal(model.fivePercent,null);
  assert.equal(model.weekPercent,72);
  assert.match(source, /id="quota-ring-week-single"/);
  assert.match(source, /nodes\.ringIcon\.classList\.toggle\('single', layout === 'single'\)/);
});
test('empty limits never masquerade as full/empty usage; percentages are clamped', () => {
  const unknown = quotaIconModel(null,null);
  assert.equal(unknown.layout,'single');
  assert.equal(unknown.fivePercent,null);
  assert.equal(unknown.weekPercent,null);
  const clamped = quotaIconModel({remaining:125},{remaining:-4});
  assert.equal(clamped.fivePercent,100);
  assert.equal(clamped.weekPercent,0);
  assert.match(source, /percent === null \? '0 100'/);
});
test('quota ring matches desktop diamond layout and native sidebar alignment', () => {
  assert.match(source, /quota-ring-diamond/);
  assert.match(source, /padding:0 8px 7px 19px/);
  assert.match(source, /svg class="quota-icon" viewBox="0 0 36 36"/);
  assert.match(source, /popup opens beside the nav/);
  assert.match(source, /aria-label', label/);
});
