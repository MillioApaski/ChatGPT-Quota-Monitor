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
  assert.match(source, /@sandbox\s+DOM/);
  assert.doesNotMatch(source, /@grant\s+none/);
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
  assert.match(source, /if \(!workPanel && !sidebar\) \{\s*setDiagnostic\('profile-not-found'/);
  assert.ok(source.includes("',planText=' + profileScanStats.text"));
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
  assert.match(source, /function profileCandidate\(\)/);
  assert.match(source, /function isInExpandedNavigation\(element\)/);
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
test('quota trigger retains desktop-like diamond and native sidebar row', () => {
  assert.ok(source.includes('quota-ring-diamond'));
  assert.ok(source.includes('class="sidebar-trigger-label">额度</span>'));
  assert.ok(source.includes('svg class="quota-icon" viewBox="0 0 36 36"'));
  assert.ok(source.includes('width:100%; height:44px'));
  assert.ok(source.includes('left:var(--cg-ring-left, 16px)'));
  assert.ok(source.includes('left:var(--cg-label-left, 64px)'));
  assert.ok(source.includes('width:28px; height:28px'));
  assert.ok(source.includes("aria-label', label"));
});

test('popover nodes resolve from their own Shadow DOM to avoid initialization crash', () => {
  const markup = source.slice(source.indexOf('sidebarCard.innerHTML = '), source.indexOf('// Popover and its styling'));
  const nodes = source.slice(source.indexOf('const nodes = {'), source.indexOf('  function syncTheme()'));
  const names = {
    sidebarPlan: 'sidebar-plan',
    sidebarFive: 'sidebar-five',
    sidebarWeek: 'sidebar-week',
    sidebarCredits: 'sidebar-credits',
    sidebarRefresh: 'sidebar-refresh',
  };
  for (const [name, id] of Object.entries(names)) {
    assert.ok(markup.includes('id="' + id + '"'), 'popup contains ' + id);
    assert.ok(nodes.includes(name + ": popupShadow.getElementById('" + id + "')"),
      name + ' must resolve from popupShadow');
  }
  assert.ok(source.includes('popupShadow.append(css.cloneNode(true), sidebarCard)'));
});

const alignmentStart = source.indexOf('// BEGIN SIDEBAR_ALIGNMENT');
const alignmentEnd = source.indexOf('// END SIDEBAR_ALIGNMENT');
assert.ok(alignmentStart >= 0 && alignmentEnd > alignmentStart);
const { sidebarAlignment } = runInNewContext(
  source.slice(alignmentStart, alignmentEnd) + '\n({ sidebarAlignment })'
);
test('account avatar center and username x-position independently determine icon and label', () => {
  // Screenshot: account avatar x32..68, name x80, sidebar host x8.
  const aligned = sidebarAlignment(50, 80, 8, 28);
  assert.equal(aligned.ringLeft, 28);
  assert.equal(aligned.labelLeft, 72);
  assert.equal(8 + aligned.ringLeft + 14, 50);
  assert.equal(8 + aligned.labelLeft, 80);
});
test('missing avatar falls back to measured username, not arbitrary account-button x', () => {
  assert.ok(source.includes('locateProfileAvatar(profileButton)'));
  assert.ok(source.includes('locateProfileNameLeft(profileButton'));
  assert.ok(source.includes('measuredName !== null ? measuredName - 30 : profile.left + 18'));
  assert.ok(source.includes("root.style.setProperty('--cg-ring-left', ringLeft)"));
  assert.ok(source.includes("root.style.setProperty('--cg-label-left', labelLeft)"));
  assert.ok(!source.includes("'--cg-icon-gap'"));
  assert.ok(!source.includes("'--cg-icon-indent'"));
});
test('clamps offsets for narrow sidebar variants', () => {
  const aligned = sidebarAlignment(12, 42, 40, 28);
  assert.equal(aligned.ringLeft, 0);
  assert.equal(aligned.labelLeft, 32);
});

test('both progress tracks and their consumed portions follow true circular paths', () => {
  const markup = source.slice(source.indexOf('trigger.innerHTML = '), source.indexOf('shadow.append(trigger)'));
  const expectedTop = 'M9.65 6.51 A14.2 14.2 0 0 1 26.35 6.51';
  const expectedBottom = 'M6.51 9.65 A14.2 14.2 0 1 0 29.49 9.65';
  for (const type of ['track', 'progress', 'used']) {
    assert.ok(markup.includes('class="quota-ring-' + type + '"'), type + ' exists');
  }
  assert.equal(markup.split('d="' + expectedTop + '"').length - 1, 3);
  assert.equal(markup.split('d="' + expectedBottom + '"').length - 1, 3);
  assert.ok(markup.includes('id="quota-ring-week-single-used"'));
  assert.ok(markup.includes('cx="18" cy="18" r="14.2"'));
});

test('uses actual consumed percentages and marks small usage in contrasting color', () => {
  const render = source.slice(source.indexOf('function renderQuotaIcon()'), source.indexOf('function renderSidebar()'));
  assert.ok(render.includes('const used = 100 - remaining'));
  assert.ok(render.includes('node.style.strokeDasharray ='));
  assert.ok(render.includes('node.style.strokeDashoffset ='));
  assert.ok(render.includes("node.style.opacity = used > 0 ? '1' : '0'"));
  assert.ok(render.includes('setUsed(nodes.fiveUsedRing, fivePercent)'));
  assert.ok(render.includes('setUsed(nodes.weekUsedRing, weekPercent)'));
  assert.ok(render.includes('setUsed(nodes.weekFullUsedRing, weekPercent)'));
  assert.ok(source.includes('--cg-ring-used:#ffb64d'));
  assert.ok(source.includes('stroke-linecap:round'));
  assert.equal(100 - quotaIconModel({remaining:92}, {remaining:99}).fivePercent, 8);
  assert.equal(100 - quotaIconModel({remaining:92}, {remaining:99}).weekPercent, 1);
});


test('upper and lower rings progress left-to-right with used tails on the same side', () => {
  // Upper: left end (9.65) -> right end (26.35).
  // Lower: left end (6.51) -> right end (29.49) by the long lower arc.
  const sourcePart = source.slice(source.indexOf('trigger.innerHTML = '), source.indexOf('shadow.append(trigger)'));
  const top = 'M9.65 6.51 A14.2 14.2 0 0 1 26.35 6.51';
  const lower = 'M6.51 9.65 A14.2 14.2 0 1 0 29.49 9.65';
  assert.equal(sourcePart.split('d="' + top + '"').length - 1, 3);
  assert.equal(sourcePart.split('d="' + lower + '"').length - 1, 3);
  assert.ok(sourcePart.includes('id="quota-ring-five-used"'));
  assert.ok(sourcePart.includes('id="quota-ring-week-used"'));
  assert.ok(sourcePart.includes('id="quota-ring-week-single-used"'));
  assert.ok(source.includes('node.style.strokeDashoffset ='));
});

const alignmentHelpersStart = source.indexOf('// BEGIN SIDEBAR_ALIGNMENT');
const alignmentHelpersEnd = source.indexOf('// END SIDEBAR_ALIGNMENT');
const { reconcileProfileAnchors } = runInNewContext(
  source.slice(alignmentHelpersStart, alignmentHelpersEnd) + '\n({ reconcileProfileAnchors })'
);
test('reconciles screenshot-like avatar and text drift without absolute pixel guesses', () => {
  // Reported screenshot: ring center ~51, label x~96; profile icon center ~56, name x~87.
  const anchors = reconcileProfileAnchors(51, 96, 36);
  assert.equal(anchors.avatarCenter, 58.5);
  assert.equal(anchors.nameLeft, 88.5);
  assert.equal(anchors.nameLeft - anchors.avatarCenter, 30);
  const layout = sidebarAlignment(anchors.avatarCenter, anchors.nameLeft, 15, 28);
  assert.ok(Math.abs(15 + layout.ringLeft + 14 - 56) <= 3.5);
  assert.ok(Math.abs(15 + layout.labelLeft - 87) <= 3.5);
});

test('reliable colored avatar is fixed while the username inset is corrected', () => {
  // Screenshot: measured name x96, but the colored avatar's actual center is x57.
  // Native account layout has 36px avatar and 12px gap -> username x87.
  const anchors = reconcileProfileAnchors(57, 96, 36, true);
  assert.equal(anchors.avatarCenter, 57);
  assert.equal(anchors.nameLeft, 87);
  const placed = sidebarAlignment(anchors.avatarCenter, anchors.nameLeft, 15, 28);
  assert.equal(15 + placed.ringLeft + 14, 57);
  assert.equal(15 + placed.labelLeft, 87);
  assert.ok(source.includes('reliable: isImage || (round && chroma > .30)'));
  assert.ok(source.includes('avatarRect?.width ?? 36, avatar?.reliable ?? false'));
});

test('reconciliation does not shift correctly aligned account rows or unsafe offsets', () => {
  assert.deepEqual({ ...reconcileProfileAnchors(56, 86, 36) },
    { avatarCenter: 56, nameLeft: 86 });
  assert.deepEqual({ ...reconcileProfileAnchors(56, null, 36) },
    { avatarCenter: 56, nameLeft: null });
  assert.deepEqual({ ...reconcileProfileAnchors(56, 140, 36) },
    { avatarCenter: 56, nameLeft: 140 });
});
test('avatar discovery prefers colored initials rather than neutral outer wrappers', () => {
  assert.ok(source.includes('function profileColorChroma(color)'));
  assert.ok(source.includes('chroma > .22 ? 18 * chroma'));
  assert.ok(source.includes('hasInitials ? 3'));
  assert.ok(source.includes('locateProfileAvatar(profileButton)'));
  assert.ok(source.includes('const anchors = reconcileProfileAnchors(measuredCenter, measuredName'));
});

test('preserves Work-only embedded meter and click-to-open normal chat popup', () => {
  assert.ok(source.includes('workPanel ? null : locateSidebarInsertion()'));
  assert.ok(source.includes('root.dataset.placement = placement'));
  assert.ok(source.includes('document.body.appendChild(popupRoot)'));
  assert.ok(source.includes('if (state.mode && state.mode !== placement) closePopup()'));
  assert.ok(source.includes('if (!state.active || document.hidden || state.loading) return;'));
});

const profileStart = source.indexOf('// BEGIN SIDEBAR_PROFILE_DETECTION');
const profileEnd = source.indexOf('// END SIDEBAR_PROFILE_DETECTION');
assert.ok(profileStart >= 0 && profileEnd > profileStart);
const { looksLikeProfileLocation } = runInNewContext(
  source.slice(profileStart, profileEnd) + '\n({ looksLikeProfileLocation })'
);
test('profile location check tolerates narrower account buttons in expanded sidebar', () => {
  assert.equal(looksLikeProfileLocation(
    {left:48,right:305,top:810,bottom:870,width:257,height:60}, 1645,896),true);
  assert.equal(looksLikeProfileLocation(
    {left:70,right:160,top:820,bottom:870,width:90,height:50},1645,896),true);
  assert.equal(looksLikeProfileLocation(
    {left:900,right:1100,top:820,bottom:870,width:200,height:50},1645,896),false);
});
test('mount errors and avatar measurement failures do not prevent quota rendering', () => {
  assert.ok(source.includes('try {\n        alignSidebarTrigger(sidebar.profileButton)'));
  assert.ok(source.includes('function runMountSafely()'));
  assert.ok(source.includes('runMountSafely();'));
  assert.ok(source.includes('function profileCandidate()'));
  assert.ok(source.includes("'button,[role=\"button\"]'"));
});


test('script publishes safe diagnostic status even when no profile is found', () => {
  assert.ok(source.includes("setDiagnostic('started')"));
  assert.ok(source.includes("setDiagnostic('profile-not-found')"));
  assert.ok(source.includes("setDiagnostic('mount-error', error?.name || 'Error')"));
  assert.ok(source.includes("setDiagnostic(placement === 'work' ? 'work-mounted' : 'sidebar-mounted')"));
  assert.ok(source.includes("html.dataset.cgQuotaMonitor = '1.3.7'"));
  assert.doesNotMatch(source, /dataset\.cgQuotaToken|dataset\.cgQuotaEmail/);
});


const fallbackStart = source.indexOf('// BEGIN PROFILE_FALLBACK');
const fallbackEnd = source.indexOf('// END PROFILE_FALLBACK');
assert.ok(fallbackStart >= 0 && fallbackEnd > fallbackStart);
const { accountRegionShape, scoreAccountRegion } = runInNewContext(
  source.slice(fallbackStart, fallbackEnd) + '\n({accountRegionShape, scoreAccountRegion})'
);
test('fallback accepts account footer even without a button/role/data-testid', () => {
  assert.equal(accountRegionShape({
    left:40, right:310, width:270, top:824, bottom:884, height:60
  }, 1645, 896), true);
  assert.equal(accountRegionShape({
    left:40, right:310, width:270, top:100, bottom:200, height:100
  }, 1645, 896), false);
  assert.equal(accountRegionShape({
    left:650, right:1000, width:350, top:824, bottom:884, height:60
  }, 1645, 896), false);
  assert.ok(scoreAccountRegion({height:60,bottom:884},896,true,true) >
    scoreAccountRegion({height:60,bottom:884},896,false,true));
});
test('fallback scans visible bottom-left plan labels instead of only buttons', () => {
  assert.ok(source.includes('function locateProfileByPlanText()'));
  assert.ok(source.includes('NodeFilter.SHOW_TEXT'));
  assert.ok(source.includes('if (!best) best = locateProfileByPlanText()'));
  assert.ok(source.includes('profileScanStats.text++'));
  assert.ok(source.includes('if (lastProfile?.isConnected && root.isConnected'));
  assert.ok(source.includes("setDiagnostic('profile-not-found',"));
  assert.ok(source.includes('profileScanStats.targets'));
});
