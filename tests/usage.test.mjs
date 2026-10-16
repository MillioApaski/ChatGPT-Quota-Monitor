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
test('only mounts within recognized Work panel; regular chat must not fetch quota', () => {
  assert.doesNotMatch(source, /position:fixed/);
  assert.doesNotMatch(source, /document\.documentElement\.append\(root\)/);
  assert.match(source, /if \(!panel\) \{ deactivate\(\); return; \}/);
  assert.match(source, /if \(!state\.active \|\| document\.hidden \|\| state\.loading\) return;/);
  assert.match(source, /if \(root\.parentElement !== panel\) panel\.appendChild\(root\)/);
  assert.match(source, /observer\.observe\(document\.body, \{ childList: true, subtree: true \}\)/);
});
