import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createChatTreeStore, OUTSIDE_OF_PROJECT } from './conversation-tree-store.mjs';

export async function registerModule(bus, ctx) {
  const importCoreLib = name => import(pathToFileURL(join(ctx.pluginRoot, 'lib', name)).href);
  const [
    { createGoalsStore, resolveConversationGoal, syncConversationGoal },
    { formatConversationMarkdown },
    { createPrismService },
    { readDatabase },
    proto,
    { AI_PROTOCOLS, DEFAULT_BASE_URLS, listModels: listAiModels, testConnection: testAiConnection, validateAiEndpoint },
    { createAiProvidersStore },
    { createThinkingTranslator },
    { createIntentPredictor },
    { createCredentialVault }
  ] = await Promise.all([
    importCoreLib('goals.mjs'),
    importCoreLib('session-parser.mjs'),
    importCoreLib('prism-service.mjs'),
    importCoreLib('database.mjs'),
    importCoreLib('protobuf.mjs'),
    importCoreLib('ai-provider.mjs'),
    importCoreLib('ai-providers-store.mjs'),
    importCoreLib('translator.mjs'),
    importCoreLib('intent-predictor.mjs'),
    importCoreLib('credential-vault.mjs')
  ]);

  const goals = createGoalsStore(ctx.dataDir);
  const chatTree = createChatTreeStore(ctx.dataDir, { appDir: ctx.appDir, proto });
  const prism = createPrismService({
    settings: ctx.settings,
    dataDir: ctx.dataDir,
    workspaceOf: id => {
      const movedPid = chatTree.projectOverride(id);
      if (movedPid === OUTSIDE_OF_PROJECT) return '';
      return readDatabase(ctx.appDir, id)?.workspaceUri;
    }
  });

  const secretVault = ctx.vault !== undefined ? ctx.vault : createCredentialVault({ home: ctx.home });
  const aiProviders = ctx.aiProvidersStore || createAiProvidersStore(ctx.dataDir, { vault: secretVault });
  const thinkingTranslator = ctx.translator || createThinkingTranslator({ dataDir: ctx.dataDir, home: ctx.home });
  const intentPredictor = ctx.intentPredictor || createIntentPredictor();
  const aiProvider = {
    validateAiEndpoint: ctx.aiProvider?.validateAiEndpoint || validateAiEndpoint,
    listModels: ctx.aiProvider?.listModels || listAiModels,
    testConnection: ctx.aiProvider?.testConnection || testAiConnection
  };

  const translateAbortsByClient = new Map();
  const predictAbortsByClient = new Map();

  const getClientMap = (outer, clientId = 'default') => {
    const key = String(clientId || 'default');
    let inner = outer.get(key);
    if (!inner) {
      inner = new Map();
      outer.set(key, inner);
    }
    return inner;
  };

  const abortAllInOuter = outer => {
    for (const inner of outer.values()) {
      for (const ctrl of inner.values()) {
        try { ctrl.abort(); } catch {}
      }
      inner.clear();
    }
    outer.clear();
  };

  const redactSecret = (msg, secret = '') => {
    let text = typeof msg === 'string' ? msg : String(msg || '');
    const key = typeof secret === 'string' ? secret.trim() : '';
    if (key && key.length >= 4) text = text.split(key).join('[REDACTED]');
    return text;
  };

  const resolveModelConfig = rawModelRef => {
    const found = aiProviders.resolveModel(rawModelRef);
    if (!found.ok) return { ok: false, code: found.code, error: found.error };
    const endpoint = aiProvider.validateAiEndpoint({
      protocol: found.protocol,
      baseUrl: found.baseUrl,
      apiKey: found.apiKey,
      requireKeyForRemote: true
    });
    if (!endpoint.ok) return { ok: false, code: endpoint.code, error: endpoint.error };
    const resolvedProtocol = endpoint.protocol || endpoint.provider || found.protocol;
    return {
      ok: true,
      provider: resolvedProtocol,
      protocol: resolvedProtocol,
      baseUrl: endpoint.baseUrl || DEFAULT_BASE_URLS[resolvedProtocol] || found.baseUrl,
      apiKey: found.apiKey,
      model: found.model
    };
  };

  const resolveProviderEndpoint = request => {
    const providerId = typeof request?.providerId === 'string' ? request.providerId.trim() : '';
    let protocol;
    let baseUrl;
    let apiKey;
    if (providerId) {
      const saved = aiProviders.get(providerId);
      if (!saved) return { ok: false, code: 'provider-not-found', error: `AI provider not found: ${providerId}` };
      protocol = (typeof request.protocol === 'string' && request.protocol.trim())
        ? request.protocol
        : ((typeof request.provider === 'string' && request.provider.trim()) ? request.provider : saved.protocol);
      baseUrl = request.baseUrl !== undefined ? request.baseUrl : saved.baseUrl;
      apiKey = request.apiKey !== undefined ? request.apiKey : saved.apiKey;
    } else {
      protocol = request?.protocol || request?.provider || '';
      baseUrl = request?.baseUrl;
      apiKey = typeof request?.apiKey === 'string' ? request.apiKey : '';
    }
    const cleanKey = typeof apiKey === 'string' ? apiKey.trim() : '';
    const endpoint = aiProvider.validateAiEndpoint({
      protocol,
      baseUrl,
      apiKey: cleanKey,
      requireKeyForRemote: true
    });
    if (!endpoint.ok) return { ok: false, code: endpoint.code, error: endpoint.error };
    const resolvedProtocol = endpoint.protocol || endpoint.provider || (AI_PROTOCOLS.includes(String(protocol).trim().toLowerCase()) ? String(protocol).trim().toLowerCase() : '');
    return {
      ok: true,
      provider: resolvedProtocol,
      protocol: resolvedProtocol,
      baseUrl: endpoint.baseUrl || DEFAULT_BASE_URLS[resolvedProtocol] || '',
      apiKey: cleanKey
    };
  };

  bus.on('settings.changed', 'chat-flow', (nextSettings, { prev, patch } = {}) => {
    if (!nextSettings?.enabled) {
      abortAllInOuter(translateAbortsByClient);
      abortAllInOuter(predictAbortsByClient);
      return nextSettings;
    }
    if (!nextSettings.betaThinkingTranslate && (prev?.betaThinkingTranslate || patch?.betaThinkingTranslate === false)) {
      abortAllInOuter(translateAbortsByClient);
      try { thinkingTranslator.purgeCache(); } catch {}
    }
    if (!nextSettings.betaComposerPredict && (prev?.betaComposerPredict || patch?.betaComposerPredict === false)) {
      abortAllInOuter(predictAbortsByClient);
    }
    return nextSettings;
  });

  bus.onUnload('chat-flow', () => {
    abortAllInOuter(translateAbortsByClient);
    abortAllInOuter(predictAbortsByClient);
  });

  bus.on('state.enrich', 'chat-flow', (acc, { parsed, conversationId, execution, curSettings }) => {
    const goal = curSettings.goalBar
      ? syncConversationGoal(conversationId, parsed.transcriptGoal, goals, {
          turns: parsed.turns,
          executions: parsed.executions,
          execution
        })
      : null;
    return { ...acc, goal };
  });

  bus.registerRpc('chat-flow', 'goal.save', request => {
    if (!ctx.settings.get().goalBar) throw new Error('目标栏功能已关闭');
    const saved = goals.save(request.conversationId, {
      text: request.text,
      checklist: request.checklist,
      guardrails: request.guardrails,
      sourceStepIndex: request.sourceStepIndex,
      currentStepIndex: request.currentStepIndex,
      startedAtMs: request.startedAtMs
    });
    return { ok: true, goal: resolveConversationGoal(null, saved) };
  });

  bus.registerRpc('chat-flow', 'goal.setStatus', request => {
    if (!ctx.settings.get().goalBar) throw new Error('目标栏功能已关闭');
    const saved = goals.setStatus(request.conversationId, request.status, {
      fallbackText: request.text,
      sourceStepIndex: request.sourceStepIndex,
      currentStepIndex: request.currentStepIndex,
      startedAtMs: request.startedAtMs
    });
    return {
      ok: true,
      goal: resolveConversationGoal(request.hadNativeGoal ? { status: 'active', stepIndex: -1 } : null, saved)
    };
  });

  bus.registerRpc('chat-flow', 'sessions.markdown', async (request, rpcCtx) => {
    if (!ctx.settings.get().copySessionMarkdown) throw new Error('复制会话为 Markdown 功能已关闭');
    const sshHost = await rpcCtx.resolveHost();
    const mdParams = {
      conversationId: typeof request.conversationId === 'string' ? request.conversationId : '',
      upToTurn: request.upToTurn ?? null,
      title: typeof request.title === 'string' ? request.title.slice(0, 160) : '',
      language: ctx.settings.get().language || 'zh-CN'
    };
    return sshHost
      ? ctx.remote.markdown(sshHost, mdParams)
      : formatConversationMarkdown(mdParams.conversationId, mdParams);
  });

  bus.registerRpc('chat-flow', new Set(['diff.inline', 'chatFolders.get', 'chatFolders.save']), async (request, rpcCtx) => {
    const remoteWindow = request.method === 'diff.inline' && (Boolean(await rpcCtx.resolveHost()) || rpcCtx.sshKind === 'ssh');
    return prism.request(request, { remoteWindow });
  });

  bus.registerRpc('chat-flow', 'chatTree.get', () => chatTree.get());

  bus.registerRpc('chat-flow', 'chatTree.btwMeta', () => chatTree.btwMeta());

  bus.registerRpc('chat-flow', 'chatTree.moveProject', request => {
    if (!ctx.settings.get().conversationMove) throw new Error('灵活移动会话项目功能已关闭');
    return chatTree.moveProject(request.conversationId, request.projectId);
  });

  bus.registerRpc('chat-flow', 'chatTree.setFolded', request => {
    if (!ctx.settings.get().btwSubtree) throw new Error('侧边对话子会话树功能已关闭');
    return chatTree.setFolded(request.parentConversationId, request.folded);
  });

  bus.registerRpc('chat-flow', 'chatTree.detachAside', request => {
    if (!ctx.settings.get().btwSubtree) throw new Error('侧边对话子会话树功能已关闭');
    return chatTree.detachAside(request.conversationId);
  });

  bus.registerRpc('chat-flow', 'beta.', async (request, rpcCtx = {}) => {
    const clientKey = rpcCtx.clientId || 'default';
    const clientTranslateAborts = getClientMap(translateAbortsByClient, clientKey);
    const clientPredictAborts = getClientMap(predictAbortsByClient, clientKey);

    const registerClientAbort = (map, reqId) => {
      const prevCtrl = map.get(reqId);
      if (prevCtrl) { try { prevCtrl.abort(); } catch {} map.delete(reqId); }
      const ctrl = new AbortController();
      let onClientAbort = null;
      if (rpcCtx.clientSignal) {
        if (rpcCtx.clientSignal.aborted) {
          ctrl.abort(rpcCtx.clientSignal.reason);
        } else {
          onClientAbort = () => { try { ctrl.abort(rpcCtx.clientSignal.reason); } catch {} };
          rpcCtx.clientSignal.addEventListener('abort', onClientAbort, { once: true });
        }
      }
      map.set(reqId, ctrl);
      const release = () => {
        if (onClientAbort && rpcCtx.clientSignal) {
          rpcCtx.clientSignal.removeEventListener('abort', onClientAbort);
        }
        if (map.get(reqId) === ctrl) map.delete(reqId);
      };
      return { ctrl, release };
    };

    if (request.method === 'beta.ensureLoaded') {
      const customModDir = typeof rpcCtx.resolveModuleDir === 'function' ? rpcCtx.resolveModuleDir('chat-flow') : '';
      const candidates = [
        customModDir ? join(customModDir, 'native-beta-ai.js') : '',
        join(ctx.pluginRoot, 'packages', 'chat-flow', 'native-beta-ai.js'),
        join(ctx.pluginRoot, 'lib', 'native-beta-ai.js')
      ].filter(Boolean);
      const betaPath = candidates.find(p => existsSync(p));
      if (!betaPath) throw new Error('未找到 native-beta-ai.js 模块脚本');
      if (typeof rpcCtx.pushClientEval === 'function') {
        const betaCode = readFileSync(betaPath, 'utf8');
        const evalRes = await rpcCtx.pushClientEval(`if(!globalThis.__agyBetaAi){\n${betaCode}\n}true;`, { returnByValue: true });
        if (evalRes?.exceptionDetails) {
          throw new Error(evalRes.exceptionDetails.exception?.description || evalRes.exceptionDetails.text || '加载 AI 增强模块失败');
        }
      }
      return { ok: true };
    }

    if (request.method === 'beta.providersList') {
      return { ok: true, providers: aiProviders.list() };
    }

    if (request.method === 'beta.providerSave') {
      const input = request.provider && typeof request.provider === 'object' && !Array.isArray(request.provider)
        ? request.provider
        : { ...request, id: typeof request.providerId === 'string' ? request.providerId : '' };
      const saved = aiProviders.upsert(input);
      return saved.ok
        ? { ok: true, provider: saved.provider, providers: saved.providers }
        : { ok: false, code: saved.code, error: saved.error };
    }

    if (request.method === 'beta.providerDelete') {
      const targetId = typeof request.providerId === 'string'
        ? request.providerId.trim()
        : (typeof request.id === 'string' ? request.id.trim() : '');
      const removedRes = aiProviders.remove(targetId);
      let currentSettings = ctx.settings.get();
      if (removedRes.removed && targetId) {
        const prefix = `${targetId}::`;
        const patch = {};
        for (const key of ['betaAiModel', 'betaAiTranslateModel', 'betaAiPredictModel']) {
          if (typeof currentSettings[key] === 'string' && currentSettings[key].startsWith(prefix)) {
            patch[key] = '';
          }
        }
        if (Object.keys(patch).length > 0) {
          currentSettings = ctx.settings.set(patch);
        }
      }
      return {
        ok: true,
        removed: Boolean(removedRes.removed),
        providers: removedRes.providers,
        settings: currentSettings
      };
    }

    if (request.method === 'beta.aiListModels') {
      const resolved = resolveProviderEndpoint(request);
      if (!resolved.ok) return { ok: false, models: [], code: resolved.code, error: resolved.error };
      const listed = await aiProvider.listModels({
        protocol: resolved.protocol,
        provider: resolved.protocol,
        baseUrl: resolved.baseUrl,
        apiKey: resolved.apiKey,
        home: ctx.home,
        dataDir: ctx.dataDir
      });
      return {
        ok: Boolean(listed?.ok),
        models: Array.isArray(listed?.models) ? listed.models : [],
        ...(listed?.ok ? {} : { code: listed?.code, error: redactSecret(listed?.error || '获取模型列表失败', resolved.apiKey) })
      };
    }

    if (request.method === 'beta.aiTest') {
      const rawModel = typeof request.model === 'string' ? request.model.trim() : '';
      const useModelRef = !request.providerId && !request.protocol && !request.provider && rawModel.includes('::');
      const resolved = useModelRef ? resolveModelConfig(rawModel) : resolveProviderEndpoint(request);
      if (!resolved.ok) {
        return { ok: false, latencyMs: 0, model: '', code: resolved.code, error: resolved.error };
      }
      const targetModel = useModelRef ? resolved.model : rawModel;
      const tested = await aiProvider.testConnection({
        protocol: resolved.protocol,
        provider: resolved.protocol,
        baseUrl: resolved.baseUrl,
        model: targetModel,
        apiKey: resolved.apiKey,
        home: ctx.home,
        dataDir: ctx.dataDir
      });
      return {
        ok: Boolean(tested?.ok),
        latencyMs: Number(tested?.latencyMs) || 0,
        model: typeof tested?.model === 'string' ? tested.model : targetModel,
        ...(tested?.ok ? {} : { code: tested?.code, error: redactSecret(tested?.error || '连通性测试失败', resolved.apiKey) })
      };
    }

    if (request.method === 'beta.translateThinking') {
      const cur = ctx.settings.get();
      if (cur.betaThinkingTranslate !== true) {
        return { ok: false, text: '', cached: false, engineUsed: '', code: 'disabled', error: '思维过程翻译未启用' };
      }
      const reqId = typeof request.reqId === 'string' && request.reqId.trim() ? request.reqId.trim() : `tr-${Date.now()}`;
      const text = typeof request.text === 'string' ? request.text : '';
      const targetLang = typeof request.targetLang === 'string' && request.targetLang.trim()
        ? request.targetLang.trim()
        : (cur.language || 'zh-CN');
      const contextPrev = typeof request.contextPrev === 'string' ? request.contextPrev : '';
      const engine = cur.betaThinkingEngine === 'ai' ? 'ai' : 'free';
      let aiConfig = null;
      if (engine === 'ai') {
        const aiModelRef = (cur.betaAiTranslateModel || cur.betaAiModel || '').trim();
        const resolved = resolveModelConfig(aiModelRef);
        if (!resolved.ok) {
          return { ok: false, text: '', cached: false, engineUsed: engine, code: resolved.code, error: resolved.error };
        }
        aiConfig = {
          provider: resolved.protocol,
          baseUrl: resolved.baseUrl,
          model: resolved.model,
          apiKey: resolved.apiKey
        };
      }
      const { ctrl, release } = registerClientAbort(clientTranslateAborts, reqId);
      let pendingAcc = '';
      let deltaTimer = null;
      let lastPushAt = 0;
      const pushDelta = acc => {
        if (ctrl.signal.aborted || typeof rpcCtx.pushClientEval !== 'function') return;
        lastPushAt = Date.now();
        void rpcCtx.pushClientEval(`globalThis.__agyBetaTranslateDelta?.(${JSON.stringify(reqId)},${JSON.stringify(acc)})`).catch(() => {});
      };
      const onDelta = (_chunk, acc) => {
        if (ctrl.signal.aborted || typeof acc !== 'string') return;
        pendingAcc = acc;
        const elapsed = Date.now() - lastPushAt;
        if (elapsed >= 32) {
          if (deltaTimer) { clearTimeout(deltaTimer); deltaTimer = null; }
          pushDelta(pendingAcc);
        } else if (!deltaTimer) {
          deltaTimer = setTimeout(() => {
            deltaTimer = null;
            pushDelta(pendingAcc);
          }, 32 - elapsed);
        }
      };
      try {
        const res = await thinkingTranslator.translate({
          text,
          targetLang,
          engine,
          aiConfig,
          contextPrev,
          signal: ctrl.signal,
          onDelta
        });
        return {
          ok: Boolean(res?.ok !== false),
          text: typeof res?.text === 'string' ? res.text : '',
          cached: Boolean(res?.cached),
          engineUsed: typeof res?.engine === 'string' && res.engine ? res.engine : engine,
          ...(res?.skipped ? { skipped: true } : {}),
          ...(res?.transport ? { transport: res.transport } : {})
        };
      } catch (err) {
        if (err?.name === 'AbortError' || err?.code === 'ABORT_ERR' || ctrl.signal.aborted) {
          return { ok: false, aborted: true, text: '', cached: false, engineUsed: engine, error: 'Request aborted' };
        }
        return {
          ok: false,
          text: '',
          cached: false,
          engineUsed: engine,
          code: err?.code || 'translate-failed',
          error: redactSecret(err?.message || '翻译失败', aiConfig?.apiKey || '')
        };
      } finally {
        if (deltaTimer) { clearTimeout(deltaTimer); deltaTimer = null; }
        release();
      }
    }

    if (request.method === 'beta.abortTranslate') {
      const reqId = typeof request.reqId === 'string' ? request.reqId.trim() : '';
      let aborted = false;
      if (reqId && clientTranslateAborts.has(reqId)) {
        const ctrl = clientTranslateAborts.get(reqId);
        clientTranslateAborts.delete(reqId);
        try { ctrl.abort(); } catch {}
        aborted = true;
      }
      return { ok: true, aborted };
    }

    if (request.method === 'beta.clearTranslateCache') {
      thinkingTranslator.purgeCache();
      return { ok: true };
    }

    if (request.method === 'beta.predictIntent') {
      const cur = ctx.settings.get();
      if (cur.betaComposerPredict !== true) {
        return { ok: false, suggestion: '', skipped: true, code: 'disabled', error: '输入框意图预测未启用' };
      }
      const reqId = typeof request.reqId === 'string' && request.reqId.trim() ? request.reqId.trim() : `pr-${Date.now()}`;
      const aiModelRef = (cur.betaAiPredictModel || cur.betaAiModel || '').trim();
      const resolved = resolveModelConfig(aiModelRef);
      if (!resolved.ok) {
        return { ok: false, suggestion: '', skipped: true, code: resolved.code, error: resolved.error };
      }
      const { ctrl, release } = registerClientAbort(clientPredictAborts, reqId);
      try {
        const res = await intentPredictor.predict({
          conversationId: typeof request.conversationId === 'string' ? request.conversationId : '',
          turnId: typeof request.turnId === 'string' ? request.turnId : '',
          turns: Array.isArray(request.turns) ? request.turns : [],
          language: typeof request.language === 'string' ? request.language : '',
          aiConfig: {
            provider: resolved.protocol,
            baseUrl: resolved.baseUrl,
            model: resolved.model,
            apiKey: resolved.apiKey
          },
          home: ctx.home,
          dataDir: ctx.dataDir,
          signal: ctrl.signal
        });
        return {
          ok: Boolean(res?.ok),
          suggestion: typeof res?.suggestion === 'string' ? res.suggestion : '',
          skipped: Boolean(res?.skipped),
          ...(res?.cached ? { cached: true } : {}),
          ...(res?.aborted ? { aborted: true } : {}),
          ...(!res?.ok && res?.error ? { code: res.code, error: redactSecret(res.error, resolved.apiKey) } : {})
        };
      } finally {
        release();
      }
    }

    if (request.method === 'beta.abortPredict') {
      const reqId = typeof request.reqId === 'string' ? request.reqId.trim() : '';
      let aborted = false;
      if (reqId && clientPredictAborts.has(reqId)) {
        const ctrl = clientPredictAborts.get(reqId);
        clientPredictAborts.delete(reqId);
        try { ctrl.abort(); } catch {}
        aborted = true;
      }
      return { ok: true, aborted };
    }

    throw new Error('不支持的操作');
  });
}
