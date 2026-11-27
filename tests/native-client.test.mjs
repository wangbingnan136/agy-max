import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('execution snapshot reads native lifecycle only for the requested conversation',()=>{
  let snapshot={conversationId:'current',status:2,turns:[{startStepIndex:7}],executorMetadata:{terminationReason:0}};
  const value={cascadeContext:{state:{agentStateProvider:{getState:()=>snapshot}}}};
  const element={'__reactFiber$fixture':{tag:10,type:{},memoizedProps:{value},return:null}};
  const context=vm.createContext({document:{querySelector:()=>element}});
  vm.runInContext(readFileSync(new URL('../lib/native-client.js',import.meta.url),'utf8'),context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.__agyNativeAdapter.executionState('current'))),{conversationId:'current',status:2,turnStartStepIndex:7,terminationReason:0});
  assert.equal(context.__agyNativeAdapter.executionState('other'),null);
  snapshot={...snapshot,turns:[]};assert.equal(context.__agyNativeAdapter.executionState('current'),null);
});

test('executionState surfaces SYSTEM_MESSAGE wakeup origin, notFullyIdle, and active subagents',()=>{
  const summaries={
    main:{notFullyIdle:true},
    'sub-1':{parentConversationId:'main',status:2,trajectoryMetadata:{subagentSpec:{role:'UI Verification'}}},
    'sub-done':{parentConversationId:'main',status:1,trajectoryMetadata:{subagentSpec:{role:'Finished Check'}}}
  };
  const reduxStore={getState:()=>({trajectorySummaries:{summaries}}),dispatch(){}};
  const snapshot={
    conversationId:'main',status:1,
    turns:[{startStepIndex:10},{startStepIndex:12}],
    executorMetadata:{terminationReason:4},
    trajectorySlice:{
      stepsSlice:{startIndex:10},
      stepsInSlice:[
        {step:{case:'userInput',value:{}}},
        {step:{case:'plannerResponse',value:{response:'Working'}}},
        {step:{case:'systemMessage',value:{}}},
        {step:{case:'plannerResponse',value:{response:'Dispatched'}}}
      ]
    }
  };
  const element={
    '__reactFiber$fixture':{
      tag:10,type:{},memoizedProps:{value:{store:reduxStore}},
      return:{tag:10,type:{},memoizedProps:{value:{cascadeContext:{state:{agentStateProvider:{getState:()=>snapshot}}}}},return:null}
    }
  };
  const context=vm.createContext({document:{querySelector:()=>element,querySelectorAll:()=>[element]}});
  vm.runInContext(readFileSync(new URL('../lib/native-client.js',import.meta.url),'utf8'),context);
  const ex=JSON.parse(JSON.stringify(context.__agyNativeAdapter.executionState('main')));
  assert.equal(ex.status,1);
  assert.equal(ex.turnStartStepIndex,12);
  assert.equal(ex.userTurnStartStepIndex,10);
  assert.equal(ex.isSystemTurn,true);
  assert.equal(ex.notFullyIdle,true);
  assert.deepEqual(ex.activeSubagents,[{title:'UI Verification',status:'running'}]);
});

test('master switch restores renamed native hooks and reuses saved enhancements on enable',async()=>{
  const original={checkpointConfig:{enabled:true},plannerConfig:{noToolExplanation:true}};
  const nativeResolve=()=>original,nativeSegment=()=>({body:{type:'collapsible'}}),send=payload=>payload;
  const service={forkConversation(){},sendUserCascadeMessage:send};
  const element={'__reactFiber$fixture':{tag:10,type:{},memoizedProps:{value:service},return:null}};
  const context=vm.createContext({document:{querySelector:()=>element},renamedResolve:nativeResolve,renamedSegment:nativeSegment,
    __agyNativeBindings:{names:{resolve:'renamedResolve',segment:'renamedSegment',menu:'renamedMenu'}},I:{},tc:(_,value)=>structuredClone(value),Wb:(_,value)=>value});
  vm.runInContext(readFileSync(new URL('../lib/native-client.js',import.meta.url),'utf8'),context);
  const adapter=context.__agyNativeAdapter;
  adapter.setStageUpdates(true);adapter.setContextLimit(1000000);adapter.setEfficientIO(true);adapter.setPragmaticCoding(true);
  assert.equal(context.renamedResolve().checkpointConfig.maxTokenLimit,1000000);
  adapter.setEnabled(false);
  assert.equal(context.renamedResolve,nativeResolve);assert.equal(context.renamedSegment,nativeSegment);assert.equal(service.sendUserCascadeMessage,send);
  assert.equal(adapter.stageUpdates,false);assert.equal(context.sjc,undefined);assert.equal(context.Yyc,undefined);
  adapter.setEnabled(true);
  const config=context.renamedResolve();assert.equal(config.checkpointConfig.maxTokenLimit,1000000);
  assert.deepEqual(Array.from(config.plannerConfig.promptSectionCustomizationConfig.appendPromptSections,p=>p.title),['powertools_stage_updates','powertools_efficient_io','powertools_pragmatic_coding']);
  adapter.setPragmaticCoding(false);
  assert.deepEqual(Array.from(context.renamedResolve().plannerConfig.promptSectionCustomizationConfig.appendPromptSections,p=>p.title),['powertools_stage_updates','powertools_efficient_io']);
  adapter.setGoalBar(true);
  adapter.setConversationGoal('conv-goal',{
    text:'Ship all tests green',
    status:'active',
    checklist:[{id:'c1',text:'Update unit tests',done:true},{id:'c2',text:'Run full suite',done:false}],
    guardrails:['run_tests','minimal_diff']
  });
  const sentWithGoal=await service.sendUserCascadeMessage({cascadeId:'conv-goal',items:[{chunk:{case:'text',value:'continue'}}]});
  const goalPrompt=sentWithGoal.cascadeConfig.plannerConfig.promptSectionCustomizationConfig.appendPromptSections.find(p=>p.title==='powertools_active_goal')?.content||'';
  assert.ok(goalPrompt.includes('Ship all tests green'));
  assert.ok(goalPrompt.includes('- [x] Update unit tests')&&goalPrompt.includes('- [ ] Run full suite'));
  assert.ok(goalPrompt.includes('Execution Guardrails:')&&goalPrompt.includes('smallest necessary surgical changes'));
  adapter.setConversationGoal('conv-goal',{text:'Ship all tests green',status:'paused',pausedNative:true});
  const sentWhilePausedNative=await service.sendUserCascadeMessage({cascadeId:'conv-goal',items:[{chunk:{case:'text',value:'继续'}}]});
  assert.ok(sentWhilePausedNative.cascadeConfig.plannerConfig.promptSectionCustomizationConfig.appendPromptSections.some(p=>p.title==='powertools_active_goal'&&p.content.includes('GOAL_CANCELLED')&&!p.content.includes('<GOAL>')));
  adapter.setConversationGoal('conv-goal',{text:'Ship all tests green',status:'paused',pausedNative:false});
  const sentWhilePausedClean=await service.sendUserCascadeMessage({cascadeId:'conv-goal',items:[{chunk:{case:'text',value:'继续'}}]});
  assert.equal((sentWhilePausedClean.cascadeConfig?.plannerConfig?.promptSectionCustomizationConfig?.appendPromptSections||[]).some(p=>p.title==='powertools_active_goal'),false);
  adapter.setConversationGoal('conv-goal',null);
  adapter.dispose();assert.equal(context.renamedResolve,nativeResolve);assert.equal(context.renamedSegment,nativeSegment);
});

test('native fork inherits history via ForkConversation without sending a model prompt', async () => {
  const calls = [];
  const service = { async getCascadeTrajectory() { return { trajectory: { steps: [{metadata:{index:42},step:{case:'plannerResponse'}},{metadata:{index:43},step:{case:'systemMessage'}},{metadata:{index:44},step:{case:'userInput'}}] } }; }, async forkConversation(request) { calls.push(request); return { newCascadeId: 'new-id', newProjectId: 'project-id', forkedAtStepIndex: 183, warnings: [] }; } };
  const element = { '__reactFiber$fixture': { tag: 5, return: { tag: 10, type: {}, memoizedProps: { value: service }, return: null } } };
  const context = vm.createContext({ document: { querySelector: () => element }, HU: metadata => metadata.index });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
  const result = await context.__agyNativeAdapter.fork('source-id');
  assert.equal(result.conversationId, 'new-id');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ sourceCascadeId: 'source-id', forkAtStepIndex: -1, targetForkWorkspace: 1 }]);
  await context.__agyNativeAdapter.fork('source-id', 42);
  assert.equal(calls[1].forkAtStepIndex, 43);
  assert.equal(await context.__agyNativeAdapter.forkPoint('source-id', 44), -1);
  await assert.rejects(context.__agyNativeAdapter.fork('../source', 4), /Invalid/);
  await assert.rejects(context.__agyNativeAdapter.fork('source', -2), /Invalid/);
  assert.equal(calls.length, 2);
  await context.__agyNativeAdapter.fork('source-id', 42, { exact: true });
  assert.equal(calls[2].forkAtStepIndex, 42);
});

test('fork automatically promotes via Side Question and cleans up temp trajectory when direct fork rejects subagents', async () => {
  const events = [];
  const service = {
    async getCascadeTrajectory() { return { trajectory: { steps: [{ metadata: { index: 10 }, step: { case: 'plannerResponse' } }, { metadata: { index: 11 }, step: { case: 'userInput' } }] } }; },
    async startCascade(req) { events.push({ op: 'startCascade', trajectoryType: req.trajectoryType, parent: req.baseTrajectoryIdentifier?.identifier?.value, cascadeId: req.cascadeId }); },
    async forkConversation(req) {
      events.push({ op: 'forkConversation', sourceCascadeId: req.sourceCascadeId, forkAtStepIndex: req.forkAtStepIndex });
      if (req.sourceCascadeId === 'sub-chat') throw new Error('failed to create forked conversation: forking is not supported for conversations that have invoked subagents');
      return { newCascadeId: 'promoted-id', newProjectId: 'proj-1', forkedAtStepIndex: req.forkAtStepIndex, warnings: [] };
    },
    async deleteCascadeTrajectory(id) { events.push({ op: 'delete', id }); }
  };
  const element = { '__reactFiber$fixture': { tag: 5, return: { tag: 10, type: {}, memoizedProps: { value: service }, return: null } } };
  const context = vm.createContext({ document: { querySelector: () => element }, HU: m => m.index, crypto: { randomUUID: () => 'sq-temp-1' } });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);

  const resEnd = await context.__agyNativeAdapter.fork('sub-chat', -1);
  assert.equal(resEnd.conversationId, 'promoted-id');
  assert.equal(resEnd.promotedViaSideQuestion, true);
  assert.deepEqual(JSON.parse(JSON.stringify(events)), [
    { op: 'forkConversation', sourceCascadeId: 'sub-chat', forkAtStepIndex: -1 },
    { op: 'startCascade', trajectoryType: 22, parent: 'sub-chat', cascadeId: 'sq-temp-1' },
    { op: 'forkConversation', sourceCascadeId: 'sq-temp-1', forkAtStepIndex: -1 },
    { op: 'delete', id: 'sq-temp-1' }
  ]);

  events.length = 0;
  const resHist = await context.__agyNativeAdapter.fork('sub-chat', 10, { exact: true });
  assert.equal(resHist.conversationId, 'promoted-id');
  assert.equal(events[2].forkAtStepIndex, 10);
  assert.deepEqual(JSON.parse(JSON.stringify(events[3])), { op: 'delete', id: 'sq-temp-1' });
});

test('forked conversations automatically receive an incremented (N) title annotation', async () => {
  const annotationCalls = [];
  const summaries = {
    'source-1': { summary: '优化 README 文件指南' },
    'existing-1': { annotations: { title: '优化 README 文件指南 (1)' } }
  };
  const reduxStore = { getState: () => ({ trajectorySummaries: { summaries } }), dispatch() {} };
  const service = {
    async getCascadeTrajectory() { return { trajectory: { steps: [] } }; },
    async forkConversation() { return { newCascadeId: 'forked-2', newProjectId: 'proj-1', forkedAtStepIndex: -1, warnings: [] }; },
    async updateConversationAnnotations(ids, ann, merge) { annotationCalls.push([ids, ann, merge]); }
  };
  const element = {
    '__reactFiber$fixture': {
      tag: 10, type: {}, memoizedProps: { value: { store: reduxStore } },
      return: { tag: 10, type: {}, memoizedProps: { value: service }, return: null }
    }
  };
  const context = vm.createContext({
    document: { querySelector: () => element, querySelectorAll: () => [] },
    HU: m => m.index,
    YF: { ConversationAnnotationsSchema: 'ann-schema' },
    Wb: (schema, value) => ({ schema, ...value })
  });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
  const adapter = context.__agyNativeAdapter;
  assert.equal(adapter.nextBranchTitle('测试会话', []), '测试会话 (1)');
  assert.equal(adapter.nextBranchTitle('测试会话 (1)', ['测试会话', '测试会话 (1)']), '测试会话 (2)');

  await adapter.fork('source-1');
  assert.equal(annotationCalls.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(annotationCalls[0])), [['forked-2'], { schema: 'ann-schema', title: '优化 README 文件指南 (2)' }, true]);
});

test('unreadCount tracks idle completed background chats and unfocused active chat while excluding subagents and archived chats', () => {
  const summaries = {
    'active-chat': { lastModifiedTime: { seconds: 200 }, annotations: { lastUserViewTime: { seconds: 150 } }, notFullyIdle: false },
    'bg-done': { lastModifiedTime: { seconds: 300 }, annotations: { lastUserViewTime: { seconds: 100 } }, notFullyIdle: false },
    'bg-running': { lastModifiedTime: { seconds: 400 }, annotations: { lastUserViewTime: { seconds: 100 } }, notFullyIdle: true },
    'subagent-1': { lastModifiedTime: { seconds: 400 }, annotations: { lastUserViewTime: { seconds: 100 } }, parentConversationId: 'active-chat', nestingDepth: 1 },
    'archived-1': { lastModifiedTime: { seconds: 400 }, annotations: { lastUserViewTime: { seconds: 100 }, archived: true } },
    'old-unviewed': { lastModifiedTime: { seconds: 400 }, annotations: {} },
    'manual-unread': { lastModifiedTime: { seconds: 50 }, annotations: { markedAsUnread: true } }
  };
  const reduxStore = { getState: () => ({ trajectorySummaries: { summaries }, conversation: { localLastViewedTimes: { 'bg-done': 120 } } }), dispatch() {} };
  const element = { '__reactFiber$fixture': { tag: 10, type: {}, memoizedProps: { value: { store: reduxStore } }, return: null } };
  const context = vm.createContext({ document: { querySelector: () => element } });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
  assert.equal(context.__agyNativeAdapter.unreadCount('active-chat', true), 2); // bg-done + manual-unread
  assert.equal(context.__agyNativeAdapter.unreadCount('active-chat', false), 3); // + active-chat when unfocused
});

test('message editing rewinds conversation only and preserves attachment and reference data', async () => {
  const calls = [];
  const scope = { chunk: { case: 'item', value: { file: 'reference.md' } } };
  const media = [{ uri: 'attachment.png' }];
  const message = { cascadeId: 'source', metadata: { index: 4 }, step: { items: [{ chunk: { case: 'text', value: 'before' } }, scope, { chunk: { case: 'text', value: 'after' } }], media, artifactComments: [{ comment: 'keep' }] } };
  const value = { stepHandler: { async revertToIndex(...args) { calls.push(['revert', ...args]); } }, async sendMessage(payload) { calls.push(['send', payload]); } };
  const context = vm.createContext({ document: { querySelector() {} }, HU: metadata => metadata.index });
  const element = { '__reactFiber$fixture': { tag: 0, memoizedProps: message, return: { tag: 10, type: {}, memoizedProps: { value }, return: null } } };
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
  await context.__agyNativeAdapter.editAndResend(element, 'replacement');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), ['revert', 'source', 3, { conversationOnly: true }]);
  assert.equal(calls[1][1].items[0].chunk.value, 'replacement');
  assert.equal(calls[1][1].items[1], scope); assert.equal(calls[1][1].items.length, 2);
  assert.equal(calls[1][1].media, media);
  assert.equal(calls[1][1].commentOverrides.artifactComments, message.step.artifactComments);
  await assert.rejects(context.__agyNativeAdapter.editAndResend(element, '  '), /请输入/);
  assert.equal(calls.length, 2);
  value.stepHandler.revertToIndex = async () => { throw new Error('failed'); };
  await assert.rejects(context.__agyNativeAdapter.editAndResend(element, 'retry'), /failed/);
  assert.equal(calls.length, 2);
});

test('composer-driven message editing loads rich quotes and media into Lexical, supports cancel draft restore, and rewinds before native send', async () => {
  const events = [];
  let editorState = 'draft-before', attachments = [{ uri: 'draft.png' }];
  const quoteItem = { chunk: { case: 'item', value: { scopeItem: { case: 'quote', value: { text: 'quoted snippet' } } } } };
  const message = {
    cascadeId: 'conv-1',
    metadata: { index: 6 },
    step: {
      items: [{ chunk: { case: 'text', value: 'hello ' } }, quoteItem],
      media: [{ uri: 'artifact://img1.png', mimeType: 'image/png' }],
      artifactComments: [{ comment: 'note' }]
    }
  };
  const editor = {
    getEditorState: () => editorState,
    setEditorState: next => { editorState = next; events.push(['editor', next]); },
    focus: () => events.push(['focus'])
  };
  const box = {
    lexicalRef: { current: editor },
    getMediaAttachments: () => attachments,
    setMediaAttachments: next => { attachments = next; events.push(['media', next]); },
    floatingContentRef: { current: {} }
  };
  const service = {
    forkConversation() {},
    async cancelCascadeInvocation(req) { events.push(['cancelRun', req]); },
    async sendUserCascadeMessage(payload) { events.push(['rpcSend', payload]); return { ok: true }; }
  };
  const stepHandler = {
    resolveArtifactUrl: uri => `https://local.test/${encodeURIComponent(uri)}`,
    async revertToIndex(...args) { events.push(['revert', ...args]); }
  };
  const optimistic = {
    applyOptimisticRevert(id, idx) { events.push(['optRevert', id, idx]); return { dispose: () => events.push(['optDispose']) }; }
  };
  const inputBox = { parentNode: null, nextSibling: null };
  const bottomDock = {
    isConnected: true,
    children: [inputBox],
    insertBefore(node, before) {
      node.parentNode?.children?.splice?.(node.parentNode.children.indexOf(node), 1);
      const idx = before ? this.children.indexOf(before) : this.children.length;
      this.children.splice(idx < 0 ? this.children.length : idx, 0, node);
      node.parentNode = this;
      node.nextSibling = before || null;
    }
  };
  inputBox.parentNode = bottomDock;
  inputBox.parentElement = bottomDock;
  const makeNode = tag => ({
    tag, dataset: {}, className: '', textContent: '', children: [],
    append(...items) { for (const item of items) { item.parentNode?.children?.splice?.(item.parentNode.children.indexOf(item), 1); item.parentNode = this; this.children.push(item); } },
    addEventListener() {},
    remove() { if (this.parentNode?.children) { const i = this.parentNode.children.indexOf(this); if (i >= 0) this.parentNode.children.splice(i, 1); } this.parentNode = null; }
  });
  const element = {
    attrs: new Set(), children: [],
    setAttribute(k) { this.attrs.add(k); },
    removeAttribute(k) { this.attrs.delete(k); },
    prepend(node) { node.parentNode = this; this.children.unshift(node); },
    closest: () => ({ querySelector: () => inputBox }),
    '__reactFiber$fixture': {
      tag: 0, memoizedProps: message,
      return: {
        tag: 10, type: {}, memoizedProps: { value: { stepHandler, restoreReviewComments: arg => events.push(['comments', arg.cascadeId]) } },
        return: {
          tag: 10, type: {}, memoizedProps: { value: { inputBoxRef: { current: box }, getLexicalEditor: () => editor } },
          return: {
            tag: 10, type: {}, memoizedProps: { value: optimistic },
            return: { tag: 10, type: {}, memoizedProps: { value: service }, return: null }
          }
        }
      }
    }
  };
  const context = vm.createContext({
    document: { querySelector: sel => sel ? null : element, createElement: makeNode },
    HU: m => m.index,
    LN: items => ({ serialized: items }),
    IJ: (_, json) => ({ parsed: json }),
    fetch: async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }),
    I: { CascadeConfigSchema: {} }, tc: (_, v) => structuredClone(v), Wb: (_, v) => v
  });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
  const adapter = context.__agyNativeAdapter;

  await adapter.beginEdit(element);
  assert.equal(adapter.pendingEdit.stepIndex, 6);
  assert.equal(element.attrs.has('data-agy-editing-target'), true);
  assert.equal(inputBox.parentNode, adapter.pendingEdit.inlineHost);
  assert.deepEqual(JSON.parse(JSON.stringify(editorState)), { parsed: { serialized: message.step.items } });
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].uri, '');
  assert.deepEqual(Array.from(attachments[0].payload.value), [1, 2, 3]);

  adapter.cancelEdit();
  assert.equal(adapter.pendingEdit, null);
  assert.equal(element.attrs.has('data-agy-editing-target'), false);
  assert.equal(inputBox.parentNode, bottomDock);
  assert.equal(editorState, 'draft-before');
  assert.deepEqual(JSON.parse(JSON.stringify(attachments)), [{ uri: 'draft.png' }]);

  events.length = 0;
  await adapter.beginEdit(element);
  assert.equal(inputBox.parentNode, adapter.pendingEdit.inlineHost);
  const editedItems = [{ chunk: { case: 'text', value: 'updated ' } }, quoteItem];
  const editedMedia = [...attachments, { uri: 'new-upload.png', mimeType: 'image/png' }];
  await service.sendUserCascadeMessage({ cascadeId: 'conv-1', items: editedItems, media: editedMedia, deliveryStrategy: 2 });
  assert.equal(adapter.pendingEdit, null);
  assert.equal(inputBox.parentNode, bottomDock);
  assert.equal(element.attrs.has('data-agy-editing-target'), false);
  const revertIdx = events.findIndex(e => e[0] === 'revert');
  const sendIdx = events.findIndex(e => e[0] === 'rpcSend');
  assert.ok(revertIdx >= 0 && sendIdx > revertIdx);
  assert.deepEqual(JSON.parse(JSON.stringify(events[revertIdx])), ['revert', 'conv-1', 5, { conversationOnly: true }]);
  const sent = events[sendIdx][1];
  assert.equal(sent.items, editedItems);
  assert.equal(sent.media, editedMedia);
  assert.equal(sent.deliveryStrategy, undefined);
  assert.equal(sent.artifactComments, message.step.artifactComments);
  assert.ok(events.some(e => e[0] === 'optDispose'));
});

test('suspendEdit preserves edited text and media across session switch without leaking into bottom composer', async () => {
  const makeSerialized = text => ({ text, toJSON: () => ({ root: { text } }) });
  let editorState1 = makeSerialized('normal-draft'), attachments1 = [{ uri: 'normal.png' }];
  const message = {
    cascadeId: 'conv-a',
    metadata: { index: 4 },
    step: {
      items: [{ chunk: { case: 'text', value: 'original msg' } }],
      media: [{ uri: 'artifact://orig.png', mimeType: 'image/png' }],
      artifactComments: []
    }
  };
  const makeNode = tag => ({
    tag, dataset: {}, className: '', textContent: '', children: [],
    append(...items) { for (const item of items) { item.parentNode?.children?.splice?.(item.parentNode.children.indexOf(item), 1); item.parentNode = this; this.children.push(item); } },
    addEventListener() {},
    remove() { if (this.parentNode?.children) { const i = this.parentNode.children.indexOf(this); if (i >= 0) this.parentNode.children.splice(i, 1); } this.parentNode = null; }
  });
  const buildSessionDom = (getEd, setEd, getAtt, setAtt) => {
    const editor = { getEditorState: getEd, setEditorState: setEd, focus() {} };
    const box = { lexicalRef: { current: editor }, getMediaAttachments: getAtt, setMediaAttachments: setAtt, floatingContentRef: { current: {} } };
    const inputBox = { parentNode: null, nextSibling: null };
    const bottomDock = {
      isConnected: true, children: [inputBox],
      insertBefore(node, before) {
        node.parentNode?.children?.splice?.(node.parentNode.children.indexOf(node), 1);
        const idx = before ? this.children.indexOf(before) : this.children.length;
        this.children.splice(idx < 0 ? this.children.length : idx, 0, node);
        node.parentNode = this; node.nextSibling = before || null;
      }
    };
    inputBox.parentNode = bottomDock; inputBox.parentElement = bottomDock;
    const service = { forkConversation() {}, async cancelCascadeInvocation() {}, async sendUserCascadeMessage(p) { return p; } };
    const stepHandler = { resolveArtifactUrl: uri => `https://local.test/${encodeURIComponent(uri)}`, async revertToIndex() {} };
    const element = {
      isConnected: true, attrs: new Set(), children: [],
      setAttribute(k) { this.attrs.add(k); }, removeAttribute(k) { this.attrs.delete(k); },
      prepend(node) { node.parentNode = this; this.children.unshift(node); },
      closest: () => ({ querySelector: () => inputBox }),
      '__reactFiber$fixture': {
        tag: 0, memoizedProps: message,
        return: {
          tag: 10, type: {}, memoizedProps: { value: { stepHandler } },
          return: {
            tag: 10, type: {}, memoizedProps: { value: { inputBoxRef: { current: box }, getLexicalEditor: () => editor } },
            return: { tag: 10, type: {}, memoizedProps: { value: service }, return: null }
          }
        }
      }
    };
    return { element, inputBox, bottomDock };
  };

  const dom1 = buildSessionDom(() => editorState1, v => { editorState1 = v; }, () => attachments1, v => { attachments1 = v; });
  const context = vm.createContext({
    document: { querySelector: () => dom1.element, createElement: makeNode },
    HU: m => m.index,
    LN: items => JSON.stringify({ root: { items } }),
    IJ: (_, json) => ({ parsed: JSON.parse(json), toJSON: () => JSON.parse(json) }),
    fetch: async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([9, 8]).buffer }),
    I: { CascadeConfigSchema: {} }, tc: (_, v) => structuredClone(v), Wb: (_, v) => v
  });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
  const adapter = context.__agyNativeAdapter;

  await adapter.beginEdit(dom1.element);
  // User edits text and adds another image while editing turn #4
  editorState1 = makeSerialized('in-progress edit');
  attachments1 = [...attachments1, { uri: 'extra-paste.png', mimeType: 'image/png' }];

  // User switches to another session -> suspendEdit restores original normal draft to bottom composer
  const suspended = adapter.suspendEdit();
  assert.ok(suspended);
  assert.equal(adapter.pendingEdit, null);
  assert.equal(dom1.inputBox.parentNode, dom1.bottomDock);
  assert.deepEqual(JSON.parse(JSON.stringify(editorState1.parsed)), { root: { text: 'normal-draft' } });
  assert.deepEqual(JSON.parse(JSON.stringify(attachments1)), [{ uri: 'normal.png' }]);
  assert.equal(adapter.getSuspendedEdit('conv-a').stepIndex, 4);

  // User switches back to conv-a with freshly mounted DOM & editor
  let editorState2 = makeSerialized('normal-draft'), attachments2 = [{ uri: 'normal.png' }];
  const dom2 = buildSessionDom(() => editorState2, v => { editorState2 = v; }, () => attachments2, v => { attachments2 = v; });
  const resumed = adapter.resumeEdit(dom2.element);
  assert.ok(resumed);
  assert.equal(adapter.getSuspendedEdit('conv-a'), null);
  assert.equal(dom2.inputBox.parentNode, adapter.pendingEdit.inlineHost);
  assert.deepEqual(JSON.parse(JSON.stringify(editorState2.parsed)), { root: { text: 'in-progress edit' } });
  assert.equal(attachments2.length, 2);
  assert.equal(attachments2[1].uri, 'extra-paste.png');

  // Canceling after resume still restores the original pre-edit bottom draft cleanly
  adapter.cancelEdit();
  assert.equal(dom2.inputBox.parentNode, dom2.bottomDock);
  assert.deepEqual(JSON.parse(JSON.stringify(editorState2.parsed)), { root: { text: 'normal-draft' } });
  assert.deepEqual(JSON.parse(JSON.stringify(attachments2)), [{ uri: 'normal.png' }]);
});

test('context override reaches the native config resolver and restores the default without mutating base config', () => {
  const service={forkConversation(){},sendUserCascadeMessage(payload){return payload;}};
  const element={'__reactFiber$fixture':{tag:10,type:{},memoizedProps:{value:service},return:null}};
  const originalConfig={plannerConfig:{planModel:1417},checkpointConfig:{enabled:true}};
  const originalResolve=()=>originalConfig;
  const context=vm.createContext({document:{querySelector:()=>element},sjc:originalResolve,I:{CascadeConfigSchema:{},CheckpointConfigSchema:{}},tc:(_,value)=>structuredClone(value),Wb:(_,value)=>value});
  vm.runInContext(readFileSync(new URL('../lib/native-client.js',import.meta.url),'utf8'),context);
  context.__agyNativeAdapter.setContextLimit(256000);assert.equal(context.sjc({}).checkpointConfig.maxTokenLimit,256000);
  context.__agyNativeAdapter.setContextLimit(500000);
  const resolved=context.sjc({});
  assert.equal(resolved.checkpointConfig.maxTokenLimit,500000);assert.equal(resolved.checkpointConfig.tokenThreshold,500000);
  assert.equal(resolved.checkpointConfig.enabled,true);assert.equal(originalConfig.checkpointConfig.maxTokenLimit,undefined);
  context.__agyNativeAdapter.setContextLimit(1000000);assert.equal(context.sjc({}).checkpointConfig.maxTokenLimit,1000000);
  context.__agyNativeAdapter.setContextLimit(0);assert.equal(context.sjc,originalResolve);
  assert.throws(()=>context.__agyNativeAdapter.setContextLimit(42),/上下文/);
});

test('stage updates compose with context limits, show live updates and fold them before the final answer',()=>{
  const service={forkConversation(){},sendUserCascadeMessage(payload){return payload;}};
  const element={'__reactFiber$fixture':{tag:10,type:{},memoizedProps:{value:service},return:null}};
  const base={plannerConfig:{noToolExplanation:true,promptSectionCustomizationConfig:{appendPromptSections:[{title:'existing',content:'preserve'}]}},checkpointConfig:{enabled:true}};
  const resolve=()=>base;
  const modelText={type:'step',step:{step:{case:'plannerResponse',value:{response:'Reading the next file.'}}}};
  const final={type:'lastTextResponse',step:{step:{case:'plannerResponse',value:{response:'Final answer'}}}};
  const render=arg=>({leadingSteps:arg.leadingSteps||[],tailSteps:[final],body:{type:'collapsible',isActive:arg.running,content:{groups:arg.groups}}});
  const context=vm.createContext({document:{querySelector:()=>element},sjc:resolve,Yyc:render,I:{},tc:(_,value)=>structuredClone(value),Wb:(_,value)=>value});
  vm.runInContext(readFileSync(new URL('../lib/native-client.js',import.meta.url),'utf8'),context);
  const adapter=context.__agyNativeAdapter;
  adapter.setStageUpdates(true);adapter.setContextLimit(1000000);
  const patchedResolve=context.sjc;
  vm.runInContext(readFileSync(new URL('../lib/native-client.js',import.meta.url),'utf8'),context);
  assert.equal(context.__agyNativeAdapter,adapter);
  assert.equal(context.sjc,patchedResolve);
  const config=context.sjc({});
  assert.equal(config.plannerConfig.noToolExplanation,false);
  assert.equal(config.checkpointConfig.maxTokenLimit,1000000);
  assert.deepEqual(Array.from(config.plannerConfig.promptSectionCustomizationConfig.appendPromptSections,p=>p.title),['existing','powertools_stage_updates']);
  assert.equal(base.plannerConfig.noToolExplanation,true);
  assert.equal(base.plannerConfig.promptSectionCustomizationConfig.appendPromptSections.length,1);
  const content=context.Yyc({groups:[modelText],running:true}).body;
  assert.equal(content.type,'inline');assert.equal(content.content.groups[0],modelText);
  const complete=context.Yyc({groups:[modelText],leadingSteps:[modelText],running:false});
  assert.equal(complete.body.type,'collapsible');assert.equal(complete.body.defaultExpanded,false);
  assert.equal(complete.leadingSteps.length,0);assert.equal(complete.body.content.groups.length,2);
  assert.equal(complete.tailSteps[0],final);assert.ok(!complete.body.content.groups.includes(final));
  const thinking={type:'thinkingIndicator',thinking:'not user-facing'};
  assert.equal(context.Yyc({groups:[thinking]}).body.type,'collapsible');
  adapter.setEfficientIO(true);
  let prompts=context.sjc({}).plannerConfig.promptSectionCustomizationConfig.appendPromptSections;
  assert.deepEqual(Array.from(prompts,p=>p.title),['existing','powertools_stage_updates','powertools_efficient_io']);
  assert.match(prompts.at(-1).content,/prefer rg/);
  assert.match(prompts.at(-1).content,/operating system/);
  adapter.setStageUpdates(false);
  assert.equal(context.Yyc,render);
  assert.equal(context.sjc({}).checkpointConfig.maxTokenLimit,1000000);
  assert.equal(context.sjc({}).plannerConfig.noToolExplanation,true);
  prompts=context.sjc({}).plannerConfig.promptSectionCustomizationConfig.appendPromptSections;
  assert.deepEqual(Array.from(prompts,p=>p.title),['existing','powertools_efficient_io']);
  adapter.setContextLimit(0);assert.notEqual(context.sjc,resolve);
  adapter.setEfficientIO(false);assert.equal(context.sjc,resolve);
  adapter.dispose();assert.equal(context.Yyc,render);
  assert.equal(adapter.active,false);
  vm.runInContext(readFileSync(new URL('../lib/native-client.js',import.meta.url),'utf8'),context);
  assert.notEqual(context.__agyNativeAdapter,adapter);
  assert.equal(context.__agyNativeAdapter.active,true);
});

test('setSidebarProjectLimit controls per-project visible rows, supports show-all, and restores cleanly',()=>{
  const nativeFlat=args=>{
    const out=[];
    for(const g of args.groups){
      out.push({type:'header',id:`header-${g.id}`,label:g.label});
      const collapsed=args.onlyShowFirstFewConvos?.[g.id]??true;
      const slice=collapsed?g.items.slice(0,6):g.items;
      for(const it of slice)out.push({type:'row',id:it.cascadeId,cascadeId:it.cascadeId,isIndented:true,groupId:g.id});
      if(g.items.length>6)out.push({type:'show-more',id:`show-more-${g.id}`,label:collapsed?`See all (${g.items.length})`:'See less',groupId:g.id,isIndented:true});
    }
    return out;
  };
  const context=vm.createContext({
    document:{querySelector:()=>null},
    __agyNativeBindings:{names:{resolve:'sjc',segment:'Yyc',menu:'lHc',sidebarItems:'VWc'}},
    VWc:nativeFlat
  });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js',import.meta.url),'utf8'),context);
  const adapter=context.__agyNativeAdapter;
  const groups=[{id:'p1',label:'Proj1',items:Array.from({length:8},(_,i)=>({cascadeId:`c${i}`}))}];
  const call=flags=>context.VWc({groups,groupBy:'project',onlyShowFirstFewConvos:flags});

  adapter.setSidebarProjectLimit(2);
  let items=call({});
  assert.equal(items.filter(x=>x.type==='row').length,2);
  assert.equal(items.at(-1).type,'show-more');assert.equal(items.at(-1).label,'See all (8)');

  items=call({p1:false});
  assert.equal(items.filter(x=>x.type==='row').length,8);
  assert.equal(items.at(-1).label,'See less');

  adapter.setSidebarProjectLimit(-1);
  items=call({});
  assert.equal(items.filter(x=>x.type==='row').length,8);
  assert.equal(items.some(x=>x.type==='show-more'),false);

  adapter.setSidebarProjectLimit(0);
  assert.equal(context.VWc,nativeFlat);
  adapter.setSidebarProjectLimit(3);
  adapter.dispose();
  assert.equal(context.VWc,nativeFlat);
});

test('setSidebarProjectPin enables Codex-style project pinning, orders loose pinned chats above pinned folders, and restores cleanly',()=>{
  let pinnedIds=['proj-b'];
  const togglePin=id=>{pinnedIds=pinnedIds.includes(id)?pinnedIds.filter(x=>x!==id):[...pinnedIds,id];};
  const nativeSidebarItems=args=>{
    const out=[];
    const hasPinnedSection=(args.pinnedWorkspaces?.length||0)>0||(args.sortedPinnedIds?.length||0)>0;
    if(hasPinnedSection){
      out.push({type:'section-header',id:'section-pinned',title:'Pinned'});
      for(const w of args.pinnedWorkspaces||[]){
        out.push({type:'header',id:`header-${w.id}`,label:w.label,isCollapsed:false});
        for(const it of w.items.slice(0,5))out.push({type:'row',id:it.cascadeId,cascadeId:it.cascadeId,isIndented:true,groupId:w.id,folderId:w.id});
        if(w.items.length>5)out.push({type:'show-more',id:`show-more-${w.id}`,label:`Show ${w.items.length-5} More`,groupId:w.id,isIndented:true});
      }
      for(const cid of args.sortedPinnedIds||[]){
        out.push({type:'row',id:cid,cascadeId:cid,isIndented:false,groupId:'pinned'});
      }
      out.push({type:'spacer',id:'spacer-section-pinned',height:16});
    }
    for(const g of args.groups||[]){
      out.push({type:'header',id:`header-${g.id}`,label:g.label});
      for(const it of g.items)out.push({type:'row',id:it.cascadeId,cascadeId:it.cascadeId,isIndented:true,groupId:g.id});
    }
    return out;
  };
  const nativeSidebarData=args=>{
    const pSet=new Set(args.pinnedProjectIds||[]);
    const pinnedWorkspaces=(args.groups||[]).filter(g=>pSet.has(g.id));
    const groups=(args.groups||[]).filter(g=>!pSet.has(g.id));
    const flatItems=context.VWc({groups,groupBy:'project',pinnedWorkspaces,sortedPinnedIds:['pin-chat-1','pin-chat-2'],onlyShowFirstFewConvos:{}});
    return {groups,pinnedWorkspaces,flatItems,togglePagination:()=>{},onlyShowFirstFewConvos:{},visibleConversationGroupSectionIds:[]};
  };
  let renderedHeaderProps=null;
  const nativeProjectHeader=props=>{renderedHeaderProps=props;return props;};
  let hookCalls=0,storageListeners=0;
  const storageService={
    get:key=>key==='pinnedProjectIds'?JSON.stringify(pinnedIds):key==='pinned_workspace_row_order'?'{}':undefined,
    onDidChange:()=>{storageListeners++;return()=>{storageListeners--;};}
  };
  const pageEl={'__reactFiber$p':{tag:10,memoizedProps:{value:{core:{storageService}}},return:null}};
  const context=vm.createContext({
    document:{querySelector:sel=>sel==='#root'?{firstElementChild:pageEl}:null},
    __agyNativeBindings:{
      names:{
        resolve:'sjc',
        segment:'Yyc',
        menu:'lHc',
        sidebarItems:'VWc',
        sidebarData:'Bkd',
        projectHeader:'Tld',
        pinnedProjectsHook:'Uic',
        togglePinProjectHook:'Wic'
      }
    },
    VWc:nativeSidebarItems,
    Bkd:nativeSidebarData,
    Tld:nativeProjectHeader,
    Uic:()=>{hookCalls++;return [pinnedIds,()=>{}];},
    Wic:()=>togglePin
  });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js',import.meta.url),'utf8'),context);
  const adapter=context.__agyNativeAdapter;
  adapter.setSidebarProjectPin(true);

  const allGroups=[
    {id:'proj-a',label:'magpie',items:[{cascadeId:'a1'}]},
    {id:'proj-b',label:'instabox管理工具',items:Array.from({length:7},(_,i)=>({cascadeId:`b${i}`}))}
  ];
  const res=context.Bkd({groups:allGroups,includePinnedSection:true,archivedOnly:false,pinnedProjectIds:[]});
  // sidebarData is swapped in after the sidebar mounted, so it must read storage instead of calling hooks (React #311).
  assert.equal(hookCalls,0);
  assert.equal(storageListeners,1);
  // Pinned project moves out of unpinned groups into pinnedWorkspaces
  assert.deepEqual(Array.from(res.groups,g=>g.id),['proj-a']);
  assert.deepEqual(Array.from(res.pinnedWorkspaces,g=>g.id),['proj-b']);
  // Codex order inside section-pinned: loose pinned chats FIRST, then pinned project folder + 5 rows + Show 2 More!
  const pinnedSliceIds=Array.from(res.flatItems.slice(0,res.flatItems.findIndex(i=>i.id==='spacer-section-pinned')),i=>i.id);
  assert.deepEqual(pinnedSliceIds,[
    'section-pinned',
    'pin-chat-1',
    'pin-chat-2',
    'header-proj-b',
    'b0','b1','b2','b3','b4',
    'show-more-proj-b'
  ]);

  // Project header receives isPinned and onTogglePin automatically, and clears unpinned drag onPointerDown
  context.Tld({projectId:'proj-b',isPinned:false,onPointerDown:()=>{}});
  assert.equal(renderedHeaderProps.isPinned,true);
  assert.equal(renderedHeaderProps.onPointerDown,undefined);
  assert.equal(typeof renderedHeaderProps.onTogglePin,'function');
  renderedHeaderProps.onTogglePin('proj-b');
  assert.deepEqual(pinnedIds,[]);

  adapter.dispose();
  assert.equal(storageListeners,0);
  assert.equal(context.VWc,nativeSidebarItems);
  assert.equal(context.Bkd,nativeSidebarData);
  assert.equal(context.Tld,nativeProjectHeader);
});

test('composerCascadeId resolves nearest conversationId or effectiveCascadeId for side-question and split-pane composers',()=>{
  const context=vm.createContext({document:{querySelector:()=>null}});
  vm.runInContext(readFileSync(new URL('../lib/native-client.js',import.meta.url),'utf8'),context);
  const adapter=context.__agyNativeAdapter;
  const sideQuestionEl={
    '__reactFiber$sq':{
      memoizedProps:{},
      return:{
        memoizedProps:{conversationId:'sq-123',parentCascadeId:'main-1',isSideQuestion:true},
        return:{memoizedProps:{cascadeId:'main-1'},return:null}
      }
    }
  };
  const effectiveEl={
    '__reactFiber$eff':{
      memoizedProps:{effectiveCascadeId:'sq-456',parentCascadeId:'main-1'},
      return:{memoizedProps:{cascadeId:'main-1'},return:null}
    }
  };
  assert.equal(adapter.composerCascadeId(sideQuestionEl),'sq-123');
  assert.equal(adapter.composerCascadeId(effectiveEl),'sq-456');
});

test('fileTreeEntry extracts file and folder URIs and attachFileToComposer routes media via attachFiles and files/dirs via native mention helpers', async () => {
  const attached = [];
  const fileMentions = [];
  const scopeMentions = [];
  let focused = 0;
  const editor = { focus() { focused++; } };
  const box = {
    lexicalRef: { current: editor },
    async attachFiles(files) { attached.push(...files); },
    getInputCardElement: () => ({ scrollIntoView() {} })
  };
  const inputBoxEl = {
    '__reactFiber$ib': {
      tag: 10,
      memoizedProps: { value: { inputBoxRef: { current: box }, getLexicalEditor: () => editor } },
      return: null
    }
  };
  const treeRowEl = {
    '__reactFiber$row': {
      memoizedProps: {},
      return: {
        memoizedProps: { entry: { uri: 'file:///workspace/assets/logo.png', fileType: 1 } },
        return: null
      }
    }
  };
  const dirRowEl = {
    '__reactFiber$dir': {
      memoizedProps: { entry: { uri: 'file:///workspace/docs', fileType: 2 } },
      return: null
    }
  };
  const context = vm.createContext({
    atob,
    Uint8Array,
    File,
    document: {
      activeElement: null,
      querySelector: sel => sel.includes('agent-input-box') ? inputBoxEl : null
    },
    MUa: (ed, uri) => fileMentions.push({ ed, uri }),
    Shd: (kind, uri) => ({ kind, uri }),
    Gy: (ed, item) => scopeMentions.push({ ed, item })
  });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
  const adapter = context.__agyNativeAdapter;

  const childInFileRow = { closest: sel => sel === '[role="treeitem"]' ? treeRowEl : null };
  const childInDirRow = { closest: sel => sel === '[role="treeitem"]' ? dirRowEl : null };
  assert.deepEqual({ ...adapter.fileTreeEntry(childInFileRow) }, { uri: 'file:///workspace/assets/logo.png', isDirectory: false });
  assert.deepEqual({ ...adapter.fileTreeEntry(childInDirRow) }, { uri: 'file:///workspace/docs', isDirectory: true });

  const mediaRes = await adapter.attachFileToComposer({
    mode: 'media',
    name: 'logo.png',
    mimeType: 'image/png',
    base64: Buffer.from('PNGDATA').toString('base64')
  });
  assert.equal(mediaRes.mode, 'media');
  assert.equal(attached.length, 1);
  assert.equal(attached[0].name, 'logo.png');
  assert.equal(attached[0].type, 'image/png');
  assert.equal(attached[0].size, 7);

  const fileRes = await adapter.attachFileToComposer({
    mode: 'mention',
    kind: 'file',
    uri: 'file:///workspace/src/app.js',
    name: 'app.js'
  });
  assert.equal(fileRes.mode, 'mention');
  assert.deepEqual(fileMentions, [{ ed: editor, uri: 'file:///workspace/src/app.js' }]);

  const dirRes = await adapter.attachFileToComposer({
    mode: 'mention',
    kind: 'directory',
    isDirectory: true,
    uri: 'file:///workspace/docs',
    name: 'docs'
  });
  assert.equal(dirRes.kind, 'directory');
  assert.deepEqual(scopeMentions, [{ ed: editor, item: { kind: 'directory', uri: 'file:///workspace/docs' } }]);
  assert.equal(focused, 3);
});

test('stable sendUserCascadeMessage wrapper preserves edit revert even when composer destructured send while config overrides were off', async () => {
  const events = [];
  const editor = { getEditorState: () => ({ toJSON: () => ({ root: {} }) }), setEditorState() {}, focus() {} };
  const box = { lexicalRef: { current: editor }, getMediaAttachments: () => [], setMediaAttachments() {}, floatingContentRef: { current: {} } };
  const inputBox = { parentNode: null, nextSibling: null };
  const bottomDock = { isConnected: true, children: [inputBox], insertBefore() {} };
  inputBox.parentNode = bottomDock; inputBox.parentElement = bottomDock;
  const service = {
    forkConversation() {},
    async cancelCascadeInvocation() {},
    async sendUserCascadeMessage(payload) { events.push(['send', payload.cascadeId]); return payload; }
  };
  const stepHandler = {
    async revertToIndex(id, idx, opts) { events.push(['revert', id, idx, opts]); }
  };
  const message = { cascadeId: 'conv-stable', metadata: { index: 4 }, step: { items: [{ chunk: { case: 'text', value: 'old' } }], media: [], artifactComments: [], fileDiffComments: [], fileComments: [] } };
  const element = {
    isConnected: true, attrs: new Set(), children: [],
    setAttribute() {}, removeAttribute() {}, prepend() {},
    closest: () => ({ querySelector: () => inputBox }),
    '__reactFiber$fixture': {
      tag: 0, memoizedProps: message,
      return: {
        tag: 10, type: {}, memoizedProps: { value: { stepHandler } },
        return: {
          tag: 10, type: {}, memoizedProps: { value: { inputBoxRef: { current: box }, getLexicalEditor: () => editor } },
          return: { tag: 10, type: {}, memoizedProps: { value: service }, return: null }
        }
      }
    }
  };
  const makeNode = () => ({ dataset: {}, className: '', textContent: '', append() {}, addEventListener() {}, remove() {} });
  const context = vm.createContext({
    document: { querySelector: () => element, createElement: makeNode },
    HU: m => m.index,
    LN: items => JSON.stringify({ root: { items } }),
    IJ: (_, json) => JSON.parse(json),
    I: { CascadeConfigSchema: {} }, tc: (_, v) => structuredClone(v), Wb: (_, v) => v
  });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
  const adapter = context.__agyNativeAdapter;
  // All config overrides OFF when conversation mounts and destructures sendUserCascadeMessage (just like native useMemo)
  adapter.setStageUpdates(false);
  adapter.setEfficientIO(false);
  adapter.setContextLimit(0);
  adapter.ensureRequestHook();
  const capturedSend = service.sendUserCascadeMessage;

  // Later user clicks Edit -> composer calls the previously captured send closure
  await adapter.beginEdit(element);
  await capturedSend({ cascadeId: 'conv-stable', items: [{ chunk: { case: 'text', value: 'edited' } }], media: [] });
  assert.deepEqual(JSON.parse(JSON.stringify(events)), [
    ['revert', 'conv-stable', 3, { conversationOnly: true }],
    ['send', 'conv-stable']
  ]);
});

test('conversationDirectory and workspaceUri classify running, unread, projects, and exclude subagents', () => {
  const summaries = {
    'run-new': {
      status: 2,
      notFullyIdle: true,
      summary: 'Training baseline',
      lastModifiedTime: { seconds: 500 },
      trajectoryMetadata: {
        projectId: 'proj-a',
        workspaces: [{ workspaceFolderAbsoluteUri: 'file:///Users/dev/FlowIE' }]
      }
    },
    'run-old': {
      status: 2,
      summary: 'Fix auth scan',
      lastModifiedTime: { seconds: 300 },
      trajectoryMetadata: {
        projectId: 'proj-b',
        workspaces: [{ workspaceFolderAbsoluteUri: 'file:///Users/dev/somebug' }]
      }
    },
    'unread-1': {
      status: 1,
      summary: 'Completed check',
      lastModifiedTime: { seconds: 400 },
      annotations: { lastUserViewTime: { seconds: 200 } },
      trajectoryMetadata: {
        projectId: 'proj-a',
        workspaces: [{ workspaceFolderAbsoluteUri: 'file:///Users/dev/FlowIE' }]
      }
    },
    'sub-child': {
      status: 2,
      parentConversationId: 'run-new',
      lastModifiedTime: { seconds: 600 }
    }
  };
  const reduxStore = { getState: () => ({ trajectorySummaries: { summaries }, conversation: { localLastViewedTimes: {} } }), dispatch() {} };
  const element = { '__reactFiber$f': { tag: 10, type: {}, memoizedProps: { value: { store: reduxStore } }, return: null } };
  const context = vm.createContext({ document: { querySelector: () => element } });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
  const adapter = context.__agyNativeAdapter;
  assert.equal(adapter.workspaceUri('run-new'), 'file:///Users/dev/FlowIE');
  const dir = JSON.parse(JSON.stringify(adapter.conversationDirectory('other', true)));
  assert.deepEqual(dir.running.map(r => r.id), ['run-new', 'run-old']);
  assert.equal(dir.running[0].projectName, 'FlowIE');
  assert.deepEqual(dir.unread.map(u => u.id), ['unread-1']);
  assert.deepEqual(dir.subagentIds, ['sub-child']);
  assert.equal(dir.projects.length, 2);
});

test('recent workspaces deduplicate Windows drive letter case and retain the latest raw URI', () => {
  const summaries = Object.fromEntries([
    ['older', 'file:///C:/repo', 10],
    ['latest', 'file:///c:/repo', 20],
    ['other', 'file:///C:/other', 15]
  ].map(([id, uri, seconds]) => [id, { workspaceFolderAbsoluteUri: uri, lastModifiedTime: { seconds } }]));
  const store = { getState: () => ({ trajectorySummaries: { summaries } }), dispatch() {} };
  const node = { '__reactFiber$fixture': { tag: 10, memoizedProps: { value: { store } } } };
  const context = vm.createContext({ document: { querySelector: () => node } });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
  const adapter = context.__agyNativeAdapter;
  assert.deepEqual(Array.from(adapter.recentWorkspaces(), workspace => workspace.uri), ['file:///c:/repo', 'file:///C:/other']);
  assert.equal(adapter.workspaceUri('older'), 'file:///C:/repo');
});

test('composer text helpers read/write plain Lexical state and distinguish nested side composers', () => {
  let mainState = null;
  const mainRoot = { textContent: 'hello draft' };
  const mainEditor = { _rootElement: mainRoot, setEditorState: st => { mainState = st; mainRoot.textContent = st.text; }, focus() {} };
  const mainBox = { lexicalRef: { current: mainEditor } };
  const mainCard = {
    contains: el => el === mainCard,
    closest: sel => sel === '.surface-composer-card' ? mainCard : null,
    querySelector: () => mainRoot,
    '__reactFiber$main': {
      tag: 0,
      memoizedProps: { conversationId: 'conv-live' },
      return: {
        tag: 10, type: {}, memoizedProps: { value: { isNested: true, isSubagent: false } },
        return: {
          tag: 10, type: {}, memoizedProps: { value: { isNested: false, inputBoxRef: { current: mainBox }, getLexicalEditor: () => mainEditor } },
          return: null
        }
      }
    }
  };
  const sideCard = {
    contains: el => el === sideCard,
    closest: () => null,
    querySelector: () => null,
    '__reactFiber$side': {
      tag: 0,
      memoizedProps: {},
      return: {
        tag: 10, type: {}, memoizedProps: { value: { draftSideQuestionParentId: 'conv-live', isNested: true } },
        return: null
      }
    }
  };
  const context = vm.createContext({
    document: { querySelector: () => mainCard, querySelectorAll: () => [mainCard, sideCard] },
    IJ: (_, rawJson) => {
      const parsed = JSON.parse(rawJson);
      return { text: parsed?.root?.children?.[0]?.children?.[0]?.text || '' };
    }
  });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
  const adapter = context.__agyNativeAdapter;

  assert.equal(adapter.getComposerText(mainCard), 'hello draft');
  assert.equal(adapter.isNestedComposer(mainCard), false);
  assert.equal(adapter.isNestedComposer(sideCard), true);
  assert.equal(adapter.setComposerText(mainCard, '/btw check logs'), true);
  assert.equal(mainState.text, '/btw check logs');
  assert.equal(adapter.openSideChat, undefined);
  assert.equal(adapter.setSideChatCommand, undefined);
});

test('unarchiveConversations and deleteConversations sync Redux summaries optimistically and handle batch progress & errors', async () => {
  const dispatched = [];
  const updatedCalls = [];
  const deletedTrajectories = [];
  const deletedSummaries = [];
  const summaries = {
    'arch-1': { summary: 'Chat 1', annotations: { archived: true } },
    'arch-ghost': { summary: 'Ghost chat', annotations: { archived: true } },
    'arch-fail': { summary: 'Fail chat', annotations: { archived: true } }
  };
  const reduxStore = {
    getState: () => ({ trajectorySummaries: { summaries } }),
    dispatch: action => dispatched.push(action)
  };
  const svc = {
    forkConversation: async () => ({}),
    updateConversationAnnotations: async (ids, annotations, merge) => {
      updatedCalls.push({ ids, annotations, merge });
    },
    deleteCascadeTrajectory: async id => {
      if (id === 'arch-ghost') {
        const err = new Error('Trajectory not found on disk');
        err.code = 5;
        throw err;
      }
      if (id === 'arch-fail') throw new Error('disk locked');
      deletedTrajectories.push(id);
    },
    deleteSummary: async ({ cascadeId }) => {
      deletedSummaries.push(cascadeId);
    }
  };
  const element = {
    '__reactFiber$root': {
      tag: 10,
      type: {},
      memoizedProps: { value: svc },
      return: {
        tag: 10,
        type: {},
        memoizedProps: { value: { store: reduxStore } },
        return: null
      }
    }
  };
  const context = vm.createContext({
    document: { querySelector: () => element },
    YF: { ConversationAnnotationsSchema: { name: 'ConversationAnnotations' } },
    Wb: (schema, data) => ({ $schema: schema.name, ...data })
  });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
  const adapter = context.__agyNativeAdapter;

  const restoreRes = await adapter.unarchiveConversations(['arch-1', 'arch-1', 'bad id!']);
  assert.deepEqual(Array.from(restoreRes.ids), ['arch-1']);
  assert.equal(updatedCalls.length, 1);
  assert.deepEqual(Array.from(updatedCalls[0].ids), ['arch-1']);
  assert.equal(updatedCalls[0].annotations.archived, false);
  assert.equal(updatedCalls[0].annotations.$schema, 'ConversationAnnotations');
  assert.equal(updatedCalls[0].merge, true);
  assert.ok(dispatched.some(a => a.type === 'trajectorySummaries/applyOptimisticAnnotationBatch'));
  assert.ok(dispatched.some(a => a.type === 'trajectorySummaries/settleOptimisticAnnotationBatch'));

  dispatched.length = 0;
  const progressLog = [];
  const delRes = await adapter.deleteConversations(['arch-1', 'arch-ghost', 'arch-fail'], {
    onProgress: p => progressLog.push(`${p.completed}/${p.total}:${p.id}`)
  });
  assert.equal(delRes.ok, false);
  assert.equal(delRes.deletedCount, 2);
  assert.deepEqual(Array.from(delRes.deletedIds), ['arch-1', 'arch-ghost']);
  assert.equal(delRes.failed.length, 1);
  assert.equal(delRes.failed[0].id, 'arch-fail');
  assert.deepEqual(deletedTrajectories, ['arch-1']);
  assert.deepEqual(deletedSummaries, ['arch-ghost']);
  assert.deepEqual(progressLog, ['1/3:arch-1', '2/3:arch-ghost', '3/3:arch-fail']);
  assert.ok(dispatched.some(a => a.type === 'trajectorySummaries/rollbackDelete' && a.payload.cascadeId === 'arch-fail'));
});

test('installRequestOverrides fails soft when conversation service is unmounted and binds sendService later via ensureRequestHook', async () => {
  const baseConfig = { checkpointConfig: { enabled: true }, plannerConfig: { noToolExplanation: true } };
  const nativeResolve = () => baseConfig;
  const nativeSegment = arg => ({
    leadingSteps: arg.leadingSteps || [],
    tailSteps: [],
    body: { type: 'collapsible', isActive: arg.running, content: { groups: arg.groups || [] } }
  });
  let currentElement = null;
  const context = vm.createContext({
    document: { querySelector: () => currentElement },
    sjc: nativeResolve,
    Yyc: nativeSegment,
    I: { CascadeConfigSchema: {}, CheckpointConfigSchema: {}, CascadePlannerConfigSchema: {}, PromptSectionCustomizationConfigSchema: {}, PromptSectionSchema: {} },
    tc: (_, value) => structuredClone(value),
    Wb: (_, value) => value
  });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
  const adapter = context.__agyNativeAdapter;

  // On cold start / login / /customizations (no conversation service in DOM), setters must NEVER throw
  assert.doesNotThrow(() => {
    adapter.setEnabled(true);
    adapter.setStageUpdates(true);
    adapter.setEfficientIO(true);
    adapter.setPragmaticCoding(true);
    adapter.setGoalBar(true);
    adapter.setContextLimit(500000);
  });

  // Global hooks that do not require sendService are already active immediately
  const cfg = context.sjc({});
  assert.equal(cfg.checkpointConfig.maxTokenLimit, 500000);
  assert.equal(cfg.plannerConfig.noToolExplanation, false);
  assert.deepEqual(
    Array.from(cfg.plannerConfig.promptSectionCustomizationConfig.appendPromptSections, p => p.title),
    ['powertools_stage_updates', 'powertools_efficient_io', 'powertools_pragmatic_coding']
  );
  assert.notEqual(context.Yyc, nativeSegment);

  // Later, when a conversation mounts and ensureRequestHook runs, sendUserCascadeMessage is patched with saved flags
  const sentPayloads = [];
  const mountedService = {
    forkConversation() {},
    async sendUserCascadeMessage(payload) { sentPayloads.push(payload); return payload; }
  };
  currentElement = { '__reactFiber$late': { tag: 10, type: {}, memoizedProps: { value: mountedService }, return: null } };
  adapter.ensureRequestHook(currentElement);
  await mountedService.sendUserCascadeMessage({ cascadeId: 'conv-late', items: [{ chunk: { case: 'text', value: 'hi' } }] });
  assert.equal(sentPayloads.length, 1);
  assert.equal(sentPayloads[0].cascadeConfig.checkpointConfig.maxTokenLimit, 500000);
  assert.deepEqual(
    Array.from(sentPayloads[0].cascadeConfig.plannerConfig.promptSectionCustomizationConfig.appendPromptSections, p => p.title),
    ['powertools_stage_updates', 'powertools_efficient_io', 'powertools_pragmatic_coding']
  );

  adapter.dispose();
  assert.equal(context.sjc, nativeResolve);
  assert.equal(context.Yyc, nativeSegment);
});

test('installPage defers routeTree rebuild during initial router transition and reloads idle empty matches', () => {
  const parent = {
    children: [],
    addChildren(next) { this.children = next; return this; }
  };
  let loadCalls = 0;
  let updateCalls = 0;
  const mockRouter = {
    options: { routeTree: { id: '__root__' } },
    routeTree: { id: '__root__' },
    routesById: { '/manager-layout/manager-landing-layout': parent },
    state: { isLoading: true, status: 'pending', matches: [], pendingMatches: [{ id: '__root__/' }] },
    navigate() {},
    buildRouteTree() { return {}; },
    update() { updateCalls++; },
    load() { loadCalls++; }
  };
  const rootChild = { '__reactFiber$r': { tag: 10, type: {}, memoizedProps: { value: mockRouter }, return: null } };
  const injectedOverlay = { id: '', hasAttribute: name => name === 'data-agy-powertools-root' };
  const locationObj = { pathname: '/' };
  const context = vm.createContext({
    B: { createElement: () => ({}) },
    VD: opts => ({ options: opts }),
    location: locationObj,
    document: {
      querySelector: sel => sel === '#root' ? { firstElementChild: rootChild } : null,
      body: { children: [injectedOverlay, { id: 'root', firstElementChild: rootChild }], firstElementChild: injectedOverlay }
    }
  });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
  const adapter = context.__agyNativeAdapter;
  const DummyPage = () => null;

  // 1. Mid-load on '/': must defer without mutating routeTree
  assert.equal(adapter.installPage(DummyPage), false);
  assert.equal(updateCalls, 0);
  assert.equal(parent.children.length, 0);

  // 2. Idle with empty matches (stuck white screen state): installs route AND triggers r.load() recovery
  mockRouter.state = { isLoading: false, status: 'idle', matches: [], pendingMatches: [] };
  assert.equal(adapter.installPage(DummyPage), true);
  assert.equal(updateCalls, 1);
  assert.equal(parent.children.length, 1);
  assert.equal(loadCalls, 1);
});

test('canToggleAuxPane, toggleAuxPane, and project-scoped draft workspaceUri work on new conversation routes', () => {
  const executed = [];
  const commandsService = {
    hasHandler: id => id === 'toggleAuxPane',
    executeCommand: id => executed.push(id)
  };
  const storeObj = {
    getState: () => ({
      trajectorySummaries: {
        summaries: {
          'c-old': {
            lastModifiedTime: { seconds: 100 },
            trajectoryMetadata: {
              projectId: 'proj-1',
              workspaces: [{ workspaceFolderAbsoluteUri: 'file:///Users/test/proj-1-old' }]
            }
          },
          'c-latest': {
            lastModifiedTime: { seconds: 250 },
            trajectoryMetadata: {
              projectId: 'proj-1',
              workspaces: [{ workspaceFolderAbsoluteUri: 'file:///Users/test/proj-1-latest' }]
            }
          }
        }
      }
    }),
    dispatch() {}
  };
  const rootEl = {
    '__reactFiber$aux': {
      tag: 10,
      memoizedProps: { value: { store: storeObj, core: { commandsService } } },
      return: null
    }
  };
  const context = vm.createContext({
    URLSearchParams,
    location: { pathname: '/', search: '?project=proj-1' },
    document: { querySelector: sel => sel === '#root' ? { firstElementChild: rootEl } : null }
  });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
  const adapter = context.__agyNativeAdapter;

  assert.equal(adapter.canToggleAuxPane(), true);
  assert.equal(adapter.toggleAuxPane(), true);
  assert.deepEqual(executed, ['toggleAuxPane']);
  assert.equal(adapter.workspaceUri(''), 'file:///Users/test/proj-1-latest');
});

test('resumeGoalInvocation dispatches continuation via matching ChatContext.sendMessage without disturbing subagent composers', async () => {
  const sent = [];
  const subCard = {
    closest: sel => sel === '[data-testid*="side-question"],[data-testid*="subagent"]' ? {} : null,
    '__reactFiber$sub': {
      tag: 10, type: {},
      memoizedProps: { value: { cascadeContext: { state: { conversationId: 'sub-conv' } }, async sendMessage(p) { sent.push(['sub', p]); } } },
      return: null
    }
  };
  const mainCard = {
    closest: () => null,
    '__reactFiber$main': {
      tag: 10, type: {},
      memoizedProps: { value: { cascadeContext: { state: { conversationId: 'main-conv' } }, async sendMessage(p) { sent.push(['main', p]); } } },
      return: null
    }
  };
  const context = vm.createContext({
    document: {
      querySelector: () => mainCard,
      querySelectorAll: () => [subCard, mainCard]
    },
    I: { TextOrScopeItemSchema: { name: 'TextOrScopeItem' } },
    Wb: (_schema, init) => ({ $typeName: 'exa.cortex_pb.TextOrScopeItem', ...init })
  });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
  const ok = await context.__agyNativeAdapter.resumeGoalInvocation('main-conv', '继续推进当前目标');
  assert.equal(ok, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], 'main');
  assert.equal(sent[0][1].cascadeId, 'main-conv');
  assert.equal(sent[0][1].type, 1);
  assert.equal(sent[0][1].items[0].$typeName, 'exa.cortex_pb.TextOrScopeItem');
  assert.equal(sent[0][1].items[0].chunk.value, '继续推进当前目标');
  assert.equal(await context.__agyNativeAdapter.resumeGoalInvocation('../bad', 'x'), false);
});

test('inline edit submits directly on the configured send key when the composer kept a pre-hook send closure', async () => {
  const run = async ({ shortcut, keys, click = false }) => {
    const events = [];
    const listeners = [];
    const editor = { getEditorState: () => ({ toJSON: () => ({ root: { type: 'root', children: [{ type: 'paragraph', children: [{ text: 'edited text' }] }] } }) }), setEditorState() {}, focus() {} };
    const box = { lexicalRef: { current: editor }, getMediaAttachments: () => [], setMediaAttachments() {}, floatingContentRef: { current: {} } };
    const inputBox = { parentNode: null, nextSibling: null };
    const bottomDock = { isConnected: true, children: [inputBox], insertBefore(node) { node.parentNode = this; node.parentElement = this; } };
    inputBox.parentNode = bottomDock; inputBox.parentElement = bottomDock;
    const service = { forkConversation() {}, async cancelCascadeInvocation() {}, async sendUserCascadeMessage() { events.push(['rpcSend']); } };
    const chatCtx = {
      stepHandler: { async revertToIndex(id, idx, opts) { events.push(['revert', id, idx, opts]); } },
      async sendMessage(payload) { events.push(['ctxSend', payload]); }
    };
    const message = { cascadeId: 'conv-cold', metadata: { index: 4 }, step: { items: [{ chunk: { case: 'text', value: 'old' } }, { chunk: { case: 'item', value: 'mention' } }], media: [] } };
    const element = {
      isConnected: true, setAttribute() {}, removeAttribute() {}, prepend() {},
      closest: () => ({ querySelector: () => inputBox }),
      '__reactFiber$fixture': { tag: 0, memoizedProps: message, return: { tag: 10, type: {}, memoizedProps: { value: chatCtx },
        return: { tag: 10, type: {}, memoizedProps: { value: { inputBoxRef: { current: box }, getLexicalEditor: () => editor } },
          return: { tag: 10, type: {}, memoizedProps: { value: service }, return: null } } } }
    };
    const makeNode = () => ({ dataset: {}, className: '', textContent: '', append(child) { if (child) { child.parentNode = this; child.parentElement = this; } }, addEventListener(type, fn, capture) { listeners.push({ type, fn, capture: Boolean(capture) }); }, remove() {} });
    const context = vm.createContext({
      document: { querySelector: sel => /listbox|menu/.test(sel) ? null : element, createElement: makeNode },
      nativeStorage: { getItems: async () => (shortcut ? { sendMessageShortcut: shortcut } : {}) },
      HU: m => m.index, LN: items => JSON.stringify({ root: { items } }), IJ: (_, json) => JSON.parse(json),
      I: { CascadeConfigSchema: {} }, tc: (_, v) => structuredClone(v), Wb: (_, v) => v
    });
    vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
    const adapter = context.__agyNativeAdapter;
    await adapter.beginEdit(element);
    await new Promise(r => setImmediate(r));
    const fire = (type, event) => { for (const l of listeners) if (l.type === type && l.capture) l.fn(event); return event; };
    const inEditor = { closest: sel => sel.includes('contenteditable') ? {} : null };
    const results = keys.map(over => fire('keydown', { key: 'Enter', keyCode: 13, target: inEditor, prevented: false, preventDefault() { this.prevented = true; }, stopPropagation() {}, stopImmediatePropagation() {}, ...over }).prevented);
    if (click) results.push(fire('click', { target: { closest: sel => sel.includes('send-button') ? { disabled: false } : null }, prevented: false, preventDefault() { this.prevented = true; }, stopPropagation() {}, stopImmediatePropagation() {} }).prevented);
    await new Promise(r => setImmediate(r));
    return { events: JSON.parse(JSON.stringify(events)), results, adapter, inputBox, bottomDock };
  };

  // Default "Enter" setting: Shift+Enter stays a newline, Enter reverts then resends through the chat context.
  const enter = await run({ keys: [{ shiftKey: true }, {}] });
  assert.deepEqual(enter.results, [false, true]);
  assert.equal(enter.adapter.pendingEdit, null);
  assert.equal(enter.inputBox.parentNode, enter.bottomDock);
  assert.deepEqual(enter.events.map(e => e[0]), ['revert', 'ctxSend']);
  assert.deepEqual(enter.events[0], ['revert', 'conv-cold', 3, { conversationOnly: true }]);
  const sent = enter.events[1][1];
  assert.equal(sent.resend, 'edit');
  assert.deepEqual(sent.items, [{ chunk: { case: 'text', value: 'edited text' } }, { chunk: { case: 'item', value: 'mention' } }]);

  // "Cmd/Ctrl+Enter" setting: plain Enter is a newline and is left to the editor; Cmd+Enter submits.
  const mod = await run({ shortcut: 'modEnter', keys: [{}, { metaKey: true }] });
  assert.deepEqual(mod.results, [false, true]);
  assert.deepEqual(mod.events.map(e => e[0]), ['revert', 'ctxSend']);

  // Clicking the inline send button also takes the direct path.
  const click = await run({ keys: [], click: true });
  assert.deepEqual(click.results, [true]);
  assert.deepEqual(click.events.map(e => e[0]), ['revert', 'ctxSend']);
});

test('finalResponseText keeps only the answer after the last tool call', () => {
  const context = vm.createContext({ document: { querySelector: () => null }, I: { CascadeConfigSchema: {} }, tc: (_, v) => v, Wb: (_, v) => v });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
  const at = steps => ({ '__reactFiber$x': { memoizedProps: {}, return: { memoizedProps: { steps }, return: null } } });
  const planner = (response, toolCalls = []) => ({ step: { case: 'plannerResponse', value: { response, toolCalls } } });
  const { finalResponseText } = context.__agyNativeAdapter;
  assert.equal(finalResponseText(at([
    { step: { case: 'userInput', value: {} } },
    planner('Let me look.', [{ id: 't1' }]),
    { step: { case: 'runCommand', value: {} } },
    planner('Found it, checking once more.', [{ id: 't2' }]),
    planner('Here is the fix.'),
    { step: { case: 'notifyUser', value: { message: 'Done.' } } }
  ])), 'Here is the fix.\n\nDone.');
  // A reply that ends on a tool call falls back to the last thing said.
  assert.equal(finalResponseText(at([planner('Only text', [{ id: 't' }])])), 'Only text');
  assert.equal(finalResponseText({}), '');
});

test('loginUrl only surfaces an https sign-in link and cancelAccountLogin calls the native cancel', async () => {
  let snap = { active: true, authUrl: ' https://accounts.google.com/o/oauth2/auth?x=1 ', mode: 'redirect' }; let cancels = 0;
  const auth = { getLoginSessionSnapshot: () => snap, onDidChangeLoginSession: cb => { auth.cb = cb; return { dispose() { auth.cb = null; } }; }, async cancelLogin() { cancels++; } };
  const root = { '__reactFiber$x': { tag: 10, type: {}, memoizedProps: { value: { core: { authService: auth } } }, return: null } };
  const context = vm.createContext({ document: { querySelector: sel => sel === '#root' ? { firstElementChild: root } : null }, I: { CascadeConfigSchema: {} }, tc: (_, v) => v, Wb: (_, v) => v });
  vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
  const a = context.__agyNativeAdapter;
  assert.equal(a.loginUrl(), 'https://accounts.google.com/o/oauth2/auth?x=1');
  snap = { authUrl: 'javascript:alert(1)' };
  assert.equal(a.loginUrl(), '');
  const seen = []; const off = a.onLoginUrlChange(u => seen.push(u));
  auth.cb({ authUrl: 'http://insecure.example' }); auth.cb({ authUrl: 'https://ok.example/a' });
  assert.deepEqual(seen, ['', 'https://ok.example/a']);
  off(); assert.equal(auth.cb, null);
  assert.equal(await a.cancelAccountLogin(), true);
  assert.equal(cancels, 1);
});

test('attachConversationToComposer resolves commonSchemas and preserves existing @file mention pills on link fallback', async () => {
  const makeComposerContext = ({ withConversationField }) => {
    let docState = {
      root: {
        type: 'root',
        version: 1,
        children: [{
          type: 'paragraph',
          version: 1,
          children: [
            { type: 'contextScopeItemMention', data: { uri: 'file:///workspace/README.md' }, version: 1 },
            { type: 'text', text: ' Existing draft', version: 1 }
          ]
        }]
      }
    };
    const plainFromDoc = doc => (doc?.root?.children || [])
      .flatMap(p => p?.children || [])
      .filter(n => n?.type === 'text')
      .map(n => n.text)
      .join('');
    const editor = {
      _rootElement: { textContent: plainFromDoc(docState), focus() {}, contains: () => true, dispatchEvent() {} },
      focus() {},
      getEditorState: () => ({ toJSON: () => JSON.parse(JSON.stringify(docState)) }),
      setEditorState(next) {
        if (next?.root) {
          docState = next;
          editor._rootElement.textContent = plainFromDoc(docState);
        }
      }
    };
    const box = { lexicalRef: { current: editor }, getInputCardElement: () => ({ scrollIntoView() {} }) };
    const ctxValue = {
      inputBoxRef: { current: box },
      getLexicalEditor: () => editor,
      store: {
        dispatch() {},
        getState: () => ({
          trajectorySummaries: {
            summaries: {
              'conv-1': {
                annotations: { title: 'Debug Voice Button' },
                trajectoryMetadata: { workspaceFolderAbsoluteUri: 'file:///workspace/demo' }
              },
              'conv-2': { annotations: { title: 'My [Special] Chat' } }
            }
          },
          conversation: {},
          projects: {}
        })
      }
    };
    const inputBoxEl = { '__reactFiber$x': { tag: 10, type: {}, memoizedProps: { value: ctxValue }, return: null }, querySelector: () => null, getAttribute: () => null };
    const cardEl = { querySelector: sel => (sel.includes('agent-input-box') ? inputBoxEl : null) };
    const fields = withConversationField
      ? [
          { name: 'file', localName: 'file', fieldKind: 'message', message: { $typeName: 'FileRef', fields: [] } },
          {
            name: 'conversation',
            localName: 'conversation',
            fieldKind: 'message',
            message: {
              $typeName: 'ConversationRef',
              fields: [
                { name: 'cascade_id', localName: 'cascadeId', fieldKind: 'scalar' },
                { name: 'title', localName: 'title', fieldKind: 'scalar' },
                { name: 'workspace_uri', localName: 'workspaceUri', fieldKind: 'scalar' }
              ]
            }
          }
        ]
      : [{ name: 'file', localName: 'file', fieldKind: 'message', message: { $typeName: 'FileRef', fields: [] } }];
    const ctxSchema = { $typeName: 'ContextScopeItem', oneofs: [{ name: 'scopeItem', localName: 'scopeItem', fields }], fields };
    const gyCalls = [];
    const context = vm.createContext({
      document: { querySelector: sel => (sel.includes('agent-input-box') || sel.includes('Message input') ? inputBoxEl : null) },
      __agyNativeBindings: { commonSchemas: { ContextScopeItemSchema: ctxSchema }, names: { resolve: 'sjc', segment: 'Yyc', menu: 'lHc' } },
      I: { CascadeConfigSchema: {} },
      Wb: (schema, data) => ({ $typeName: schema.$typeName, ...data }),
      IJ: (_, json) => JSON.parse(json),
      Gy: (_, item) => {
        gyCalls.push(item);
        docState.root.children[0].children.push({ type: 'contextScopeItemMention', item, version: 1 });
      },
      tc: (_, v) => v
    });
    vm.runInContext(readFileSync(new URL('../lib/native-client.js', import.meta.url), 'utf8'), context);
    return { adapter: context.__agyNativeAdapter, cardEl, gyCalls, getDoc: () => docState, getText: () => plainFromDoc(docState) };
  };

  const nativeEnv = makeComposerContext({ withConversationField: true });
  const mentionRes = await nativeEnv.adapter.attachConversationToComposer({ id: 'conv-1' }, nativeEnv.cardEl);
  assert.deepEqual(JSON.parse(JSON.stringify(mentionRes)), { ok: true, mode: 'mention', kind: 'conversation', id: 'conv-1', title: 'Debug Voice Button' });
  assert.equal(nativeEnv.gyCalls.length, 1);
  assert.equal(nativeEnv.gyCalls[0].scopeItem.case, 'conversation');
  assert.equal(nativeEnv.gyCalls[0].scopeItem.value.cascadeId, 'conv-1');
  assert.equal(nativeEnv.gyCalls[0].scopeItem.value.title, 'Debug Voice Button');
  assert.equal(nativeEnv.gyCalls[0].scopeItem.value.workspaceUri, 'file:///workspace/demo');
  nativeEnv.adapter.dispose();

  const fallbackEnv = makeComposerContext({ withConversationField: false });
  const linkRes = await fallbackEnv.adapter.attachConversationToComposer({ id: 'conv-2' }, fallbackEnv.cardEl);
  assert.deepEqual(JSON.parse(JSON.stringify(linkRes)), { ok: true, mode: 'link', kind: 'conversation', id: 'conv-2', title: 'My [Special] Chat' });
  assert.equal(fallbackEnv.gyCalls.length, 0);
  assert.equal(fallbackEnv.getText(), ' Existing draft [My Special Chat](conversation://conv-2) ');
  const children = fallbackEnv.getDoc().root.children[0].children;
  assert.equal(children[0].type, 'contextScopeItemMention', 'Existing @file mention pill must not be wiped on link fallback');
  assert.equal(children[0].data.uri, 'file:///workspace/README.md');
  fallbackEnv.adapter.dispose();
});
