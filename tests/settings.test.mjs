import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPriorityStore } from '../lib/priority.mjs';
import { createSettingsStore, DEFAULT_SETTINGS } from '../lib/settings.mjs';

test('settings persist, merge safely, and reject unknown options without changing saved data', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agy-settings-'));
  try {
    const store = createSettingsStore(directory);
    assert.deepEqual(store.get(), DEFAULT_SETTINGS);
    store.set({ compact: false, timing: false });
    assert.equal(createSettingsStore(directory).get().compact, false);
    assert.equal(store.get().userBubbleTint, false);
    assert.equal(store.get().userBubblePreset, 'accent');
    assert.equal(store.get().userBubbleColor, '#2F75C3');
    store.set({ userBubbleTint: true, userBubblePreset: 'sage', userBubbleColor: '#3d7a64' });
    assert.equal(store.get().userBubbleTint, true);
    assert.equal(store.get().userBubblePreset, 'sage');
    assert.equal(store.get().userBubbleColor, '#3D7A64');
    store.set({ userBubbleTint: false, userBubblePreset: 'accent', userBubbleColor: '#2F75C3' });
    assert.equal(store.get().overviewQuota, false);
    store.set({ overviewQuota: true });
    assert.equal(store.get().overviewQuota, true);
    store.set({ overviewQuota: false });
    assert.equal(store.get().messageEdit, true);
    assert.equal(store.get().copySessionMarkdown, true);
    store.set({ copySessionMarkdown: false }); assert.equal(store.get().copySessionMarkdown, false);
    store.set({ copySessionMarkdown: true }); assert.equal(store.get().copySessionMarkdown, true);
    assert.equal(store.get().goalBar, true);
    store.set({ goalBar: false }); assert.equal(store.get().goalBar, false);
    store.set({ goalBar: true }); assert.equal(store.get().goalBar, true);
    assert.equal(store.get().fileContextMenu, true);
    assert.equal(store.get().externalEditor, 'auto');
    store.set({ externalEditor: 'cursor' }); assert.equal(store.get().externalEditor, 'cursor');
    store.set({ externalEditor: 'zed' }); assert.equal(store.get().externalEditor, 'zed');
    store.set({ externalEditor: 'auto' }); assert.equal(store.get().externalEditor, 'auto');
    assert.equal(store.get().sessionSearch, true);
    assert.equal(store.get().sessionSearchShortcut, true);
    assert.equal(store.get().sidebarFocusBell, true);
    store.set({ sidebarFocusBell: false }); assert.equal(store.get().sidebarFocusBell, false);
    store.set({ sidebarFocusBell: true }); assert.equal(store.get().sidebarFocusBell, true);
    assert.equal(store.get().gitStatusPill, true);
    store.set({ gitStatusPill: false }); assert.equal(store.get().gitStatusPill, false);
    store.set({ gitStatusPill: true }); assert.equal(store.get().gitStatusPill, true);
    store.set({ sessionSearch: false, sessionSearchShortcut: false });
    assert.equal(store.get().sessionSearch, false);
    assert.equal(store.get().sessionSearchShortcut, false);
    store.set({ sessionSearch: true, sessionSearchShortcut: true });
    assert.equal(store.get().pragmaticCoding, false);
    store.set({ pragmaticCoding: true }); assert.equal(store.get().pragmaticCoding, true);
    store.set({ pragmaticCoding: false }); assert.equal(store.get().pragmaticCoding, false);
    assert.equal(store.get().subagentTelemetry, true);
    store.set({ subagentTelemetry: false }); assert.equal(store.get().subagentTelemetry, false);
    store.set({ subagentTelemetry: true }); assert.equal(store.get().subagentTelemetry, true);
    assert.equal(store.get().multiAccount, false);
    assert.equal(store.get().accountSwitcher, true);
    assert.equal(store.get().accountViewMode, 'list');
    assert.equal(store.get().accountQuotaWindow, '5h');
    assert.equal(store.get().autoSwitchAccount, false);
    store.set({ multiAccount: true, accountSwitcher: false, accountViewMode: 'card', accountQuotaWindow: 'weekly', autoSwitchAccount: true });
    assert.equal(store.get().multiAccount, true);
    assert.equal(store.get().accountSwitcher, false);
    assert.equal(store.get().accountViewMode, 'card');
    assert.equal(store.get().accountQuotaWindow, 'weekly');
    assert.equal(store.get().autoSwitchAccount, true);
    store.set({ multiAccount: false, accountSwitcher: true, accountViewMode: 'list', accountQuotaWindow: '5h', autoSwitchAccount: false });
    assert.equal(store.get().proxyEnabled, false);
    assert.equal(store.get().proxyUrl, '');
    assert.equal(store.get().proxyBypass, 'localhost,127.0.0.1,::1,[::1]');
    assert.equal(store.get().proxyForceHttp1, false);
    store.set({ proxyEnabled: true, proxyUrl: 'http://127.0.0.1:7897/', proxyBypass: '192.168.0.0/16', proxyForceHttp1: true });
    assert.equal(store.get().proxyEnabled, true);
    assert.equal(store.get().proxyUrl, 'http://127.0.0.1:7897');
    assert.equal(store.get().proxyBypass, 'localhost,127.0.0.1,::1,[::1],192.168.0.0/16');
    assert.equal(store.get().proxyForceHttp1, true);
    store.set({ proxyEnabled: false, proxyUrl: '', proxyBypass: 'localhost,127.0.0.1,::1', proxyForceHttp1: false });
    assert.equal(store.get().sidebarProjectLimit, 0);
    store.set({ sidebarProjectLimit: 3 }); assert.equal(store.get().sidebarProjectLimit, 3);
    store.set({ sidebarProjectLimit: -1 }); assert.equal(store.get().sidebarProjectLimit, -1);
    store.set({ sidebarProjectLimit: 0 });
    assert.equal(store.get().priorityVisibleRows, 5);
    assert.equal(store.get().priorityWindow, '24h');
    assert.equal(store.get().priorityMaxItems, 5);
    assert.equal(store.get().sidebarProjectPin, true);
    assert.equal(store.get().auxFileTree, true);
    store.set({ auxFileTree: false }); assert.equal(store.get().auxFileTree, false);
    store.set({ auxFileTree: true }); assert.equal(store.get().auxFileTree, true);
    for (const rows of [3, 4, 5]) {
      store.set({ priorityVisibleRows: rows });
      assert.equal(createSettingsStore(directory).get().priorityVisibleRows, rows);
    }
    for (const win of ['15m', '1h', '6h', '24h', '3d', '7d', 'all']) {
      store.set({ priorityWindow: win });
      assert.equal(createSettingsStore(directory).get().priorityWindow, win);
    }
    for (const max of [3, 5, 10, 20]) {
      store.set({ priorityMaxItems: max });
      assert.equal(createSettingsStore(directory).get().priorityMaxItems, max);
    }
    store.set({ sidebarProjectPin: false });
    assert.equal(store.get().sidebarProjectPin, false);
    store.set({ sidebarProjectPin: true });
    assert.throws(() => store.set({ priorityVisibleRows: 6 }), /设置/);
    assert.throws(() => store.set({ priorityWindow: '2h' }), /设置/);
    assert.throws(() => store.set({ priorityMaxItems: 7 }), /设置/);
    assert.equal(store.get().priorityVisibleRows, 5);
    assert.equal(DEFAULT_SETTINGS.overviewRange, 'weeklyQuota');
    assert.equal(store.get().overviewRange, 'weeklyQuota');
    store.set({ overviewRange: '24h' }); assert.equal(store.get().overviewRange, '24h');
    store.set({ overviewRange: 'today' }); assert.equal(store.get().overviewRange, 'today');
    store.set({ overviewRange: 'weeklyQuota' }); assert.equal(store.get().overviewRange, 'weeklyQuota');
    store.set({ enabled: false }); assert.equal(store.get().enabled, false);
    assert.equal(DEFAULT_SETTINGS.contextLimit, 0);
    store.set({language:'en',contextLimit:1000000});assert.equal(store.get().contextLimit,1000000);assert.equal(store.get().language,'en');
    store.set({contextLimit:256000});assert.equal(store.get().contextLimit,256000);
    store.set({contextLimit:0});assert.equal(store.get().contextLimit,0);
    assert.equal(store.get().pinOverview, false);
    assert.equal(store.get().composerIndicatorTone, 'semantic');
    assert.equal(store.get().composerIndicatorCompact, false);
    assert.equal(store.get().composerQuota, false);
    assert.equal(store.get().composerQuotaWindow, 'auto');
    assert.equal(store.get().betaThinkingTranslate, false);
    assert.equal(store.get().betaComposerPredict, false);
    store.set({
      pinOverview: true,
      composerIndicatorTone: 'muted',
      composerIndicatorCompact: true,
      composerQuota: true,
      composerQuotaWindow: 'weekly',
      betaThinkingTranslate: true,
      betaThinkingEngine: 'ai',
      betaThinkingDisplay: 'bilingual',
      betaThinkingTrigger: 'manual',
      betaComposerPredict: true,
      betaAiModel: ' prov_1::gpt-4o-mini ',
      betaAiTranslateModel: 'prov_1::gemini-2.5-flash',
      betaAiPredictModel: 'prov_1::claude-3-5-haiku'
    });
    assert.equal(store.get().pinOverview, true);
    assert.equal(store.get().composerIndicatorTone, 'muted');
    assert.equal(store.get().composerIndicatorCompact, true);
    assert.equal(store.get().composerQuota, true);
    assert.equal(store.get().composerQuotaWindow, 'weekly');
    assert.equal(store.get().betaAiModel, 'prov_1::gpt-4o-mini');
    store.set(DEFAULT_SETTINGS);
    const before = readFileSync(join(directory, 'settings.json'), 'utf8');
    for (const value of [{ compact: 'false' }, { userBubbleTint: 'yes' }, { userBubblePreset: 'neon' }, { userBubbleColor: 'red' }, { userBubbleColor: '#123;color:red' }, { composerIndicatorTone: 'rainbow' }, { composerQuotaWindow: '1d' }, { betaThinkingEngine: 'deepl' }, { betaAiModel: 'bad\nmodel' }, { composerQuotaHalo: true }, { composerQuotaHaloWindow: 'auto' }, { unknown: true }, { toString: false }, {language:'invalid'}, {overviewRange:'custom'}, {overviewRange:'invalid'}, {accountViewMode:'grid'}, {accountQuotaWindow:'1h'}, {proxyUrl:'ftp://127.0.0.1:21'}, {proxyUrl:'http://127.0.0.1:7897;calc'}, {proxyBypass:'localhost"bad'}, {contextLimit:999999}, []]) assert.throws(() => store.set(value), /设置/);
    assert.equal(readFileSync(join(directory, 'settings.json'), 'utf8'), before);
    store.set(DEFAULT_SETTINGS); assert.deepEqual(store.get(), DEFAULT_SETTINGS);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('settings and priority read UTF-8 BOM and atomically replace legacy JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-windows-json-'));
  try {
    writeFileSync(join(dir, 'settings.json'), '\uFEFF{"language":"ja"}');
    writeFileSync(join(dir, 'priority.json'), '\uFEFF{"scopes":{"local":{"open":true}}}');
    const settings = createSettingsStore(dir);
    const priority = createPriorityStore(dir);
    assert.equal(settings.get().language, 'ja');
    assert.equal(priority.get().open, true);
    settings.set({ enabled: false });
    priority.save('local', { open: false });
    assert.equal(settings.get().language, 'ja');
    assert.equal(settings.get().enabled, false);
    assert.equal(priority.get().open, false);
    assert.deepEqual(readdirSync(dir).sort(), ['priority.json', 'settings.json']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
