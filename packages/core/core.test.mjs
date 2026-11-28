import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHookBus } from './hook-bus.mjs';
import { ALL_MODULE_IDS, DEFAULT_MODULE_IDS, OPTIONAL_MODULE_IDS, coreRangeSatisfied, detectLegacyUsedOptionalModules } from './catalog.mjs';

test('core catalog partitions 8 modules into 4 default and 4 optional without overlapping settings keys', () => {
  assert.equal(ALL_MODULE_IDS.length, 8);
  assert.deepEqual(DEFAULT_MODULE_IDS, ['telemetry', 'chat-flow', 'workspace-nav', 'i18n']);
  assert.deepEqual(OPTIONAL_MODULE_IDS, ['optics', 'accounts', 'proxy', 'ssh-remote']);
  assert.deepEqual(detectLegacyUsedOptionalModules({}), []);
  assert.deepEqual(
    detectLegacyUsedOptionalModules({ themePalette: 'obsidian', proxyEnabled: true }, { hasSavedAccounts: true, hasSavedSsh: true }).sort(),
    ['accounts', 'optics', 'proxy', 'ssh-remote']
  );
});

test('HookBus runs prioritized pipelines and unloads a single module without disturbing sibling modules', async () => {
  const bus = createHookBus();
  const calls = [];
  bus.on('beforeSend', 'chat-flow', val => `${val}+chat`, { priority: 20 });
  bus.on('beforeSend', 'optics', val => `${val}+optics`, { priority: 10 });
  bus.registerRpc('accounts', 'accounts.', req => ({ ok: true, m: req.method }));
  bus.onUnload('optics', () => calls.push('optics-disposed'));

  assert.equal(bus.runSync('beforeSend', 'msg'), 'msg+optics+chat');
  assert.deepEqual(await bus.dispatchRpc('accounts.list', { method: 'accounts.list' }), { handled: true, moduleId: 'accounts', reply: { ok: true, m: 'accounts.list' } });

  await bus.unload('optics');
  assert.deepEqual(calls, ['optics-disposed']);
  assert.equal(bus.runSync('beforeSend', 'msg'), 'msg+chat');
  assert.equal(bus.canHandleRpc('accounts.list'), true);
});

test('optics legacy detection compares every optics key to its default', () => {
  const defaults = { cornerStyle: 'balanced', targetFps: 120, userBubblePreset: 'accent', compact: true };
  assert.deepEqual(detectLegacyUsedOptionalModules({ ...defaults }, { defaults }), []);
  assert.deepEqual(detectLegacyUsedOptionalModules({ ...defaults, compact: false }, { defaults }), []);
  for (const patch of [{ cornerStyle: 'round' }, { targetFps: 60 }, { userBubblePreset: 'mint' }]) {
    assert.deepEqual(detectLegacyUsedOptionalModules({ ...defaults, ...patch }, { defaults }), ['optics']);
  }
});

test('coreRangeSatisfied supports >=X.Y.Z and exact versions', () => {
  assert.equal(coreRangeSatisfied('>=1.4.0', '1.4.2'), true);
  assert.equal(coreRangeSatisfied('>=1.4.0', '1.10.0'), true);
  assert.equal(coreRangeSatisfied('>=1.4.0', '1.3.9'), false);
  assert.equal(coreRangeSatisfied('1.4.2', '1.4.2'), true);
  assert.equal(coreRangeSatisfied('1.4.2', '1.4.3'), false);
  assert.equal(coreRangeSatisfied(undefined, '1.4.2'), true);
  assert.equal(coreRangeSatisfied('^1.4.0', '1.4.2'), false);
});

test('a throwing hook handler is logged and skipped without breaking sibling modules', async () => {
  const bus = createHookBus();
  const logged = mock.method(console, 'error', () => {});
  try {
    bus.on('slot', 'bad', () => { throw new Error('boom'); }, { priority: 1 });
    bus.on('slot', 'good', val => `${val}+good`, { priority: 2 });
    assert.equal(bus.runSync('slot', 'v'), 'v+good');
    assert.equal(await bus.runAsync('slot', 'v'), 'v+good');
    assert.match(String(logged.mock.calls[0].arguments[0]), /module "bad" hook slot failed/);
  } finally {
    logged.mock.restore();
  }
});
