(() => {
  const version='1.4.2';
  const hookNames=globalThis.__agyNativeBindings?.names||{resolve:'sjc',segment:'Yyc',menu:'lHc'};
  if(globalThis.__agyNativeAdapter?.version===version&&globalThis.__agyNativeAdapter.active)return;
  globalThis.__agyNativeAdapter?.dispose?.();
  let disposed=false;
  const fiber = element => element?.[Object.keys(element).find(key => key.startsWith('__reactFiber$'))];
  function providers(element) {
    const result = [];
    for (let node = fiber(element); node; node = node.return) {
      if (node.tag === 10 && node.memoizedProps?.value !== undefined) result.push({ type: node.type, value: node.memoizedProps.value });
    }
    return result;
  }
  function service(source) {
    const entry = providers(source || pageSource()).find(p => typeof p.value?.forkConversation === 'function');
    if (!entry) throw new Error('Antigravity conversation service is unavailable');
    return entry.value;
  }
  function wrap(child, element) {
    return providers(element).reduce((tree, p) => B.createElement(p.type, { value: p.value }, tree), child);
  }
  const pageSource = () => document.querySelector('[aria-label="Message input"],[data-agy-original-aria-label="Message input"]') || document.querySelector('a[href="/customizations"]') || document.querySelector('#root')?.firstElementChild || [...(document.body?.children || [])].find(el => el.id !== 'root' && !el.hasAttribute?.('data-agy-powertools-root') && !el.hasAttribute?.('data-agy-optics-el')) || document.body?.firstElementChild;
  const store = () => providers(pageSource()).map(p=>p.value?.store).find(s=>s?.getState&&s?.dispatch);
  const router = () => providers(pageSource()).map(p=>p.value).find(v=>typeof v?.navigate==='function'&&typeof v?.buildRouteTree==='function');
  const overview = () => providers(pageSource()).map(p=>p.value).find(v=>v?.cascadeId&&typeof v.togglePanel==='function'&&typeof v.setOverlayOpen==='function');
  const authService = () => providers(pageSource()).find(p=>p.value?.core?.authService)?.value?.core?.authService || null;
  const commandsService = () => providers(pageSource()).find(p=>p.value?.core?.commandsService)?.value?.core?.commandsService || null;
  function canToggleAuxPane() {
    const cmd=commandsService();
    if(!cmd||typeof cmd.executeCommand!=='function')return false;
    return typeof cmd.hasHandler==='function'?Boolean(cmd.hasHandler('toggleAuxPane')):true;
  }
  function toggleAuxPane() {
    const cmd=commandsService();
    if(!cmd||typeof cmd.executeCommand!=='function')return false;
    if(typeof cmd.hasHandler==='function'&&!cmd.hasHandler('toggleAuxPane'))return false;
    cmd.executeCommand('toggleAuxPane');
    return true;
  }
  function capabilities() {
    const p=providers(pageSource()),s=store()?.getState(),context=p.find(p=>p.value?.cascadeContext)?.value;
    const model=context?.cascadeContext?.state?.selectedModel;
    return {email:s?.userStatus?.email||'',name:s?.userStatus?.name||'',avatarUrl:s?.userStatus?.profilePictureUrl||'',subscription:globalThis.__agyDashboard?.subscriptionIdentity(s?.userStatus?.userTier),plan:s?.userStatus?.userTier?.name||'',planId:s?.userStatus?.userTier?.id||'',models:s?.userStatus?.cascadeModelConfigData?.clientModelConfigs?.map(m=>({label:m.label,modelId:m.modelId}))||[],model:model?.label||'',contextOptions:model?.contextWindowOptions||[],
      contextSelectionEnabled:!!p.find(p=>p.value?.getCache&&p.value?.featureNames)?.value.get('contextWindowSelector')?.enabled};
  }
  // Only an https sign-in link is ever surfaced to the UI.
  const loginAuthUrl = snap => typeof snap?.authUrl === 'string' && /^https:\/\//i.test(snap.authUrl.trim()) ? snap.authUrl.trim() : '';
  function loginUrl() {
    try { return loginAuthUrl(authService()?.getLoginSessionSnapshot?.()); } catch { return ''; }
  }
  function onLoginUrlChange(cb) {
    try {
      const sub = authService()?.onDidChangeLoginSession?.(snap => cb(loginAuthUrl(snap)));
      return () => { try { typeof sub === 'function' ? sub() : sub?.dispose?.(); } catch {} };
    } catch { return () => {}; }
  }
  async function cancelAccountLogin() {
    try { await authService()?.cancelLogin?.(); return true; } catch { return false; }
  }
  async function startAccountLogin() {
    const auth=authService();
    if(!auth||typeof auth.loginWithRedirect!=='function')throw new Error('当前客户端不支持发起登录');
    await auth.loginWithRedirect({});
    await auth.refreshUserStatus?.().catch(()=>{});
    await auth.checkCurrentAuthStatus?.().catch(()=>{});
    const cap=capabilities();
    return {ok:true,email:cap.email,name:cap.name};
  }
  function executionState(conversationId) {
    if(!conversationId)return null;
    const inputs=typeof document?.querySelectorAll==='function'?[...document.querySelectorAll('[aria-label="Message input"],[data-agy-original-aria-label="Message input"]')]:[];
    let state=null;
    for(const el of inputs){
      const candidate=providers(el).find(p=>p.value?.cascadeContext)?.value?.cascadeContext?.state?.agentStateProvider?.getState?.();
      if(candidate?.conversationId===conversationId){state=candidate;break;}
    }
    if(!state){
      const fallback=providers(pageSource()).find(p=>p.value?.cascadeContext)?.value?.cascadeContext?.state?.agentStateProvider?.getState?.();
      if(fallback?.conversationId===conversationId)state=fallback;
    }
    const turnStartStepIndex=state?.turns?.at(-1)?.startStepIndex;
    if(!state||!Number.isInteger(turnStartStepIndex))return null;
    let live=null,isSystemTurn=false,userTurnStartStepIndex=null,lastStepIndex=null;
    try{
      const slice=state?.trajectorySlice;
      const steps=Array.isArray(slice?.stepsInSlice)?slice.stepsInSlice:null;
      if(steps&&steps.length){
        const baseIdx=Number(slice?.stepsSlice?.startIndex||0);
        lastStepIndex=baseIdx+steps.length-1;
        const startStep=steps[turnStartStepIndex-baseIdx]||null;
        const startCase=String(startStep?.step?.case||'');
        if(startCase&&startCase!=='userInput')isSystemTurn=true;
        if(startCase==='userInput'){
          userTurnStartStepIndex=turnStartStepIndex;
        }else if(Array.isArray(state?.turns)){
          for(let i=state.turns.length-1;i>=0;i--){
            const idx=state.turns[i]?.startStepIndex;
            if(!Number.isInteger(idx))continue;
            const st=steps[idx-baseIdx];
            if(!st)break;
            if(st?.step?.case==='userInput'){userTurnStartStepIndex=idx;break;}
          }
        }
        const turnTail=steps.filter((_,idx)=>baseIdx+idx>=turnStartStepIndex);
        const last=turnTail.at(-1)||null;
        if(last){
          const waiting=turnTail.some(s=>s?.status===9);
          const lastCase=String(last?.step?.case||'');
          const lastStatus=Number(last?.status||0);
          const val=last?.step?.value||{};
          const toolCalls=Array.isArray(val.toolCalls)?val.toolCalls:[];
          const toolName=String(last?.metadata?.toolCall?.name||toolCalls.at(-1)?.name||'').trim();
          const errObj=lastCase==='errorMessage'?(val.error||val):null;
          const errorText=errObj?String(errObj.userErrorMessage||errObj.shortError||errObj.message||'').trim().slice(0,180):'';
          const gens=Array.isArray(slice?.generatorMetadatasInSlice)?slice.generatorMetadatasInSlice:[];
          const lastGen=gens.at(-1);
          const genError=lastGen?.error?String(lastGen.error).trim().slice(0,180):'';
          live={
            waiting,
            lastCase,
            lastStatus,
            hasThinking:Boolean(typeof val.thinking==='string'&&val.thinking.trim()),
            hasResponse:Boolean(typeof val.response==='string'&&val.response.trim()),
            toolCallCount:toolCalls.length,
            toolName,
            errorText,
            genError
          };
        }
      }
    }catch{}
    const summary=store()?.getState?.()?.trajectorySummaries?.summaries?.[conversationId];
    const notFullyIdle=Boolean(summary?.notFullyIdle);
    const activeSubagents=subagents(conversationId)
      .filter(s=>s.status==='running'||s.status==='stopping')
      .map(s=>({title:s.title,status:s.status}));
    return {
      conversationId,status:state.status,turnStartStepIndex,terminationReason:state.executorMetadata?.terminationReason,
      ...(Number.isInteger(lastStepIndex)?{lastStepIndex}:{}),
      ...(isSystemTurn?{isSystemTurn:true}:{}),
      ...(Number.isInteger(userTurnStartStepIndex)&&userTurnStartStepIndex!==turnStartStepIndex?{userTurnStartStepIndex}:{}),
      ...(notFullyIdle?{notFullyIdle:true}:{}),
      ...(activeSubagents.length?{activeSubagents}:{}),
      ...(live?{live}:{})
    };
  }
  function unreadCount(activeId='',focused=true) {
    const s=store()?.getState?.();
    const summaries=s?.trajectorySummaries?.summaries;
    if(!summaries||typeof summaries!=='object')return 0;
    const localViewed=s?.conversation?.localLastViewedTimes||{};
    let count=0;
    for(const [id,summary] of Object.entries(summaries)){
      if(!summary||summary.annotations?.archived||summary.notFullyIdle)continue;
      if(summary.parentConversationId||Number(summary.nestingDepth||0)>0)continue;
      if(summary.annotations?.markedAsUnread){count++;continue;}
      if(id===activeId&&focused)continue;
      const modified=Number(summary.lastModifiedTime?.seconds||0);
      const viewed=Math.max(Number(summary.annotations?.lastUserViewTime?.seconds||0),Number(localViewed[id]||0));
      if(modified>0&&viewed>0&&modified>viewed)count++;
    }
    return count;
  }
  function extractWorkspaceUriFromSummary(summary) {
    const meta=summary?.trajectoryMetadata||summary||{};
    const ws=Array.isArray(meta.workspaces)?meta.workspaces[0]:null;
    const candidates=[
      ws?.workspaceFolderAbsoluteUri,
      ws?.gitRootAbsoluteUri,
      ws?.absoluteUri,
      meta.workspaceFolderAbsoluteUri,
      meta.cwdUri,
      meta.workingDirectoryUri,
      summary?.workspaceFolderAbsoluteUri
    ];
    for(const item of candidates){
      if(typeof item==='string'&&item.trim().startsWith('file://'))return item.trim();
    }
    return '';
  }
  function workspaceNameFromUri(uri) {
    if(!uri)return '';
    try{
      const clean=decodeURIComponent(String(uri).split('#')[0].split('?')[0]).replace(/[\\/]+$/,'');
      const seg=clean.split(/[\\/]/).filter(Boolean).pop()||'';
      return seg;
    }catch{return '';}
  }
  function workspaceUri(conversationId='',source=null) {
    const s=store()?.getState?.();
    if(conversationId){
      const fromSummary=extractWorkspaceUriFromSummary(s?.trajectorySummaries?.summaries?.[conversationId]);
      if(fromSummary)return fromSummary;
    }else if(typeof location!=='undefined'&&location.search){
      try{
        const projectId=new URLSearchParams(location.search).get('project')?.trim()||'';
        const summaries=projectId&&projectId!=='outside-of-project'?s?.trajectorySummaries?.summaries:null;
        if(summaries&&typeof summaries==='object'){
          let bestUri='',bestSec=-1;
          for(const summary of Object.values(summaries)){
            if(!summary)continue;
            const pid=String(summary.trajectoryMetadata?.projectId||summary.projectId||'').trim();
            if(pid!==projectId)continue;
            const uri=extractWorkspaceUriFromSummary(summary);
            if(!uri)continue;
            const sec=Number(summary.lastModifiedTime?.seconds||summary.trajectoryMetadata?.createdAt?.seconds||summary.createdTime?.seconds||0);
            if(sec>bestSec){bestSec=sec;bestUri=uri;}
          }
          if(bestUri)return bestUri;
        }
      }catch{}
    }
    const list=providers(source||pageSource());
    for(const entry of list){
      const st=entry?.value?.cascadeContext?.state||entry?.value;
      const fromCtx=extractWorkspaceUriFromSummary(st);
      if(fromCtx)return fromCtx;
    }
    return '';
  }
  function conversationDirectory(activeId='',focused=true) {
    const s=store()?.getState?.();
    const summaries=s?.trajectorySummaries?.summaries;
    if(!summaries||typeof summaries!=='object')return {projects:[],byId:{},subagentIds:[],running:[],unread:[]};
    const localViewed=s?.conversation?.localLastViewedTimes||{};
    const storeProjects=s?.projects?.projects||s?.workspaces?.workspaces||{};
    const byId={},subagentIds=[],running=[],unread=[];
    const projectBuckets=new Map();
    for(const [id,summary] of Object.entries(summaries)){
      if(!summary)continue;
      const meta=summary.trajectoryMetadata||{};
      const isSubagent=Boolean(summary.parentConversationId||meta.parentConversationId||Number(summary.nestingDepth||meta.nestingDepth||0)>0);
      if(isSubagent){subagentIds.push(id);continue;}
      const archived=Boolean(summary.annotations?.archived);
      const title=String(summary.annotations?.title||summary.summary||'').trim();
      const workspaceUri=extractWorkspaceUriFromSummary(summary);
      const projectId=String(meta.projectId||summary.projectId||'').trim();
      const rawProj=projectId?storeProjects?.[projectId]:null;
      const projectName=String(rawProj?.name||rawProj?.title||workspaceNameFromUri(workspaceUri)||'').trim();
      const modifiedSec=Number(summary.lastModifiedTime?.seconds||meta.createdAt?.seconds||summary.createdTime?.seconds||0);
      const updatedAtMs=modifiedSec>0?modifiedSec*1000:0;
      const isRunning=Boolean(!summary.killed&&(summary.notFullyIdle||summary.status===2||summary.status===4));
      const viewedSec=Math.max(Number(summary.annotations?.lastUserViewTime?.seconds||0),Number(localViewed[id]||0));
      const isUnread=Boolean(!archived&&!isRunning&&(summary.annotations?.markedAsUnread||((id!==activeId||!focused)&&modifiedSec>0&&viewedSec>0&&modifiedSec>viewedSec)));
      const record={id,title,projectId,projectName,workspaceUri,archived,running:isRunning,unread:isUnread,updatedAtMs};
      byId[id]=record;
      if(!archived&&isRunning)running.push(record);
      else if(!archived&&isUnread)unread.push(record);
      const pKey=projectId||(projectName?`name:${projectName}`:'');
      if(pKey&&projectName){
        let bucket=projectBuckets.get(pKey);
        if(!bucket){bucket={id:pKey,projectId,label:projectName,conversationIds:[],updatedAtMs:0};projectBuckets.set(pKey,bucket);}
        bucket.conversationIds.push(id);
        if(updatedAtMs>bucket.updatedAtMs)bucket.updatedAtMs=updatedAtMs;
      }
    }
    running.sort((a,b)=>(b.updatedAtMs-a.updatedAtMs)||a.id.localeCompare(b.id));
    unread.sort((a,b)=>(b.updatedAtMs-a.updatedAtMs)||a.id.localeCompare(b.id));
    const projects=[...projectBuckets.values()].sort((a,b)=>(b.updatedAtMs-a.updatedAtMs)||a.label.localeCompare(b.label));
    return {projects,byId,subagentIds,running,unread};
  }
  function subagents(conversationId='') {
    if(!conversationId)return [];
    const summaries=store()?.getState?.()?.trajectorySummaries?.summaries;
    if(!summaries||typeof summaries!=='object')return [];
    const byId=new Map(Object.entries(summaries));
    const belongs=id=>{
      let cur=id;
      for(let depth=0;depth<8&&cur;depth++){
        const item=byId.get(cur);
        const meta=item?.trajectoryMetadata;
        const parent=meta?.parentConversationId||item?.parentConversationId||'';
        const root=meta?.rootConversationId||'';
        if(parent===conversationId||root===conversationId)return true;
        if(!parent||parent===cur)break;
        cur=parent;
      }
      return false;
    };
    const out=[];
    for(const [id,entry] of byId){
      if(!entry||id===conversationId||!belongs(id))continue;
      const meta=entry.trajectoryMetadata||{};
      const spec=meta.subagentSpec||{};
      const createdSec=Number(meta.createdAt?.seconds||entry.createdTime?.seconds||0);
      const modifiedSec=Number(entry.lastModifiedTime?.seconds||0);
      const status=entry.killed?'killed':(entry.status===2||entry.status===4)?'running':entry.status===3?'stopping':'done';
      out.push({
        id,
        parentId:meta.parentConversationId||entry.parentConversationId||'',
        depth:Number(meta.nestingDepth||entry.nestingDepth||1),
        typeName:String(spec.typeName||'').trim(),
        role:String(spec.role||'').trim(),
        title:String(spec.role||entry.summary||spec.typeName||'Subagent').trim(),
        status,
        stepCount:Number(entry.stepCount||0),
        createdAtMs:createdSec>0?createdSec*1000:null,
        lastModifiedAtMs:modifiedSec>0?modifiedSec*1000:null
      });
    }
    return out.sort((a,b)=>(a.depth-b.depth)||((a.createdAtMs||0)-(b.createdAtMs||0))||a.id.localeCompare(b.id));
  }
  function openSubagent(id='') {
    if(!id||typeof document==='undefined')return false;
    for(const node of document.querySelectorAll('[data-testid="subagent-node"][data-cascade-id]')){
      if(node.dataset?.cascadeId===id){node.click();return true;}
    }
    const r=router();
    if(r?.navigate){void r.navigate({to:`/c/${id}`});return true;}
    return false;
  }
  function composerCascadeId(element) {
    for(let n=fiber(element);n;n=n.return){
      const p=n.memoizedProps;
      const id=p?.conversationId||p?.effectiveCascadeId||p?.cascadeId||p?.value?.cascadeId||p?.value?.cascadeContext?.cascadeId||p?.value?.cascadeContext?.state?.conversationId;
      if(typeof id==='string'&&id)return id;
    }
    return '';
  }
  function fileTreeEntry(element) {
    const row=element?.closest?.('[role="treeitem"]');
    if(!row)return null;
    for(let node=fiber(row),depth=0;node&&depth<6;node=node.return,depth++){
      const entry=node.memoizedProps?.entry;
      if(entry&&typeof entry.uri==='string'&&entry.uri.startsWith('file://')){
        return {uri:entry.uri,isDirectory:entry.fileType===2};
      }
    }
    const iconEl=row.querySelector?.('[data-testid="file-tree-node-icon"]');
    if(iconEl){
      for(let node=fiber(iconEl)?.child,depth=0;node&&depth<6;node=node.child,depth++){
        const p=node.memoizedProps;
        if(p&&typeof p.uri==='string'&&p.uri.startsWith('file://')){
          return {uri:p.uri,isDirectory:Boolean(p.isDirectory)};
        }
      }
    }
    return null;
  }
  function findComposer(sourceEl) {
    const anchors=[];
    const scopedView=sourceEl?.closest?.('[data-testid="conversation-view"]');
    const scopedInput=scopedView?.querySelector?.('[data-testid="agent-input-box"],[aria-label="Message input"],[data-agy-original-aria-label="Message input"]');
    if(scopedInput)anchors.push(scopedInput);
    if(sourceEl)anchors.push(sourceEl);
    const activeEl=typeof document!=='undefined'?document.activeElement:null;
    const activeInput=activeEl?.closest?.('[data-testid="agent-input-box"]');
    if(activeInput)anchors.push(activeInput);
    const mainInput=typeof document!=='undefined'
      ?(document.querySelector('[data-testid="conversation-view"] [data-testid="agent-input-box"]')
        ||document.querySelector('[data-testid="agent-input-box"]')
        ||pageSource())
      :null;
    if(mainInput)anchors.push(mainInput);
    for(const anchor of anchors){
      const list=providers(anchor);
      const ibCtx=list.find(p=>p.value?.inputBoxRef&&typeof p.value?.getLexicalEditor==='function')?.value;
      const chatCtx=list.find(p=>p.value?.inputBoxRef?.current)?.value;
      const box=ibCtx?.inputBoxRef?.current||chatCtx?.inputBoxRef?.current;
      const editor=box?.lexicalRef?.current||ibCtx?.getLexicalEditor?.();
      if(box||editor)return {box,editor};
    }
    return null;
  }
  function isNestedComposer(element) {
    if(!element)return false;
    if(element.closest?.('[data-testid*="side-question"],[data-testid*="subagent"]'))return true;
    for(let node=fiber(element);node;node=node.return){
      const p=node.memoizedProps;
      const v=p?.value;
      if(p?.draftSideQuestionParentId||p?.sideQuestionOwnerId||p?.isSubagent===true)return true;
      if(v&&typeof v==='object'&&(v.draftSideQuestionParentId||v.sideQuestionOwnerId||v.isSubagent===true))return true;
    }
    return false;
  }
  function buildPlainLexicalJson(text='') {
    const val=String(text||'');
    return JSON.stringify({
      root:{
        children:[{
          children:val?[{detail:0,format:0,mode:'normal',style:'',text:val,type:'text',version:1}]:[],
          direction:null,format:'',indent:0,textFormat:0,textStyle:'paragraph',type:'paragraph',version:1
        }],
        direction:null,format:'',indent:0,type:'root',version:1
      }
    });
  }
  function getComposerText(sourceEl) {
    const target=findComposer(sourceEl);
    const rootEl=target?.editor?._rootElement||sourceEl?.querySelector?.('[contenteditable="true"]')||(sourceEl?.getAttribute?.('contenteditable')==='true'?sourceEl:null);
    if(rootEl&&typeof rootEl.textContent==='string')return rootEl.textContent;
    let out='';
    try{
      const json=target?.editor?.getEditorState?.()?.toJSON?.();
      const walk=node=>{
        if(!node||typeof node!=='object')return;
        if(typeof node.text==='string')out+=node.text;
        if(Array.isArray(node.children))for(const child of node.children)walk(child);
      };
      walk(json?.root);
    }catch{}
    return out;
  }
  function setComposerText(sourceEl, text='') {
    const target=findComposer(sourceEl);
    const editor=target?.editor;
    const val=String(text||'');
    if(editor?.setEditorState&&typeof IJ==='function'){
      try{
        editor.setEditorState(IJ(editor,buildPlainLexicalJson(val)));
        return true;
      }catch{}
    }
    const rootEl=editor?._rootElement||sourceEl?.querySelector?.('[contenteditable="true"]')||(sourceEl?.getAttribute?.('contenteditable')==='true'?sourceEl:null);
    if(rootEl){
      rootEl.textContent=val;
      if(typeof Event==='function'){
        try{rootEl.dispatchEvent(new Event('input',{bubbles:true}));}catch{}
      }
      return true;
    }
    return false;
  }
  async function attachFileToComposer(fileInfo, sourceEl) {
    if(!fileInfo||typeof fileInfo!=='object')throw new Error('文件信息无效');
    const target=findComposer(sourceEl);
    if(!target||(!target.box&&!target.editor))throw new Error('未找到可用的会话输入框');
    const {box,editor}=target;
    if(fileInfo.mode==='media'&&(fileInfo.file||fileInfo.base64)&&typeof box?.attachFiles==='function'&&typeof File==='function'){
      let file=fileInfo.file;
      if(!file){
        const raw=atob(fileInfo.base64);
        const bytes=new Uint8Array(raw.length);
        for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
        file=new File([bytes],fileInfo.name||'attachment',{type:fileInfo.mimeType||'application/octet-stream'});
      }
      await box.attachFiles([file]);
      editor?.focus?.();
      box.getInputCardElement?.()?.scrollIntoView?.({behavior:'smooth',block:'nearest'});
      return {ok:true,mode:'media',name:fileInfo.name||''};
    }
    const uri=String(fileInfo.uri||'').trim();
    const isDir=Boolean(fileInfo.isDirectory||fileInfo.kind==='directory');
    if(editor&&uri){
      if(isDir&&typeof Gy==='function'&&typeof Shd==='function'){
        Gy(editor,Shd('directory',uri));
        editor.focus?.();
        box?.getInputCardElement?.()?.scrollIntoView?.({behavior:'smooth',block:'nearest'});
        return {ok:true,mode:'mention',kind:'directory',name:fileInfo.name||''};
      }
      if(!isDir&&typeof MUa==='function'){
        MUa(editor,uri);
        editor.focus?.();
        box?.getInputCardElement?.()?.scrollIntoView?.({behavior:'smooth',block:'nearest'});
        return {ok:true,mode:'mention',kind:'file',name:fileInfo.name||''};
      }
      if(typeof Gy==='function'&&typeof Shd==='function'){
        Gy(editor,Shd(isDir?'directory':'file',uri));
        editor.focus?.();
        box?.getInputCardElement?.()?.scrollIntoView?.({behavior:'smooth',block:'nearest'});
        return {ok:true,mode:'mention',kind:isDir?'directory':'file',name:fileInfo.name||''};
      }
    }
    throw new Error('当前输入框暂不支持直接引用该文件');
  }
  let originalSend,wrappedSend,sendService,originalResolve,originalSegmentRender,stageSegmentRender,originalSidebarItems,wrappedSidebarItems,originalSidebarData,wrappedSidebarData,originalProjectHeader,wrappedProjectHeader;
  let contextLimit=0,stageUpdatesEnabled=false,efficientIOEnabled=false,pragmaticCodingEnabled=false,goalBarEnabled=false,inlineImagesEnabled=false,runtimeEnabled=true,sidebarProjectLimit=0,sidebarProjectPinEnabled=false;
  let pendingEdit=null;
  const conversationGoals=new Map(),goalDetectListeners=new Set();
  const editListeners=new Set(),notifyEdit=()=>{for(const listener of editListeners)listener(pendingEdit);};
  function onEditChange(listener){editListeners.add(listener);return()=>editListeners.delete(listener);}
  function onGoalDetected(listener){goalDetectListeners.add(listener);return()=>goalDetectListeners.delete(listener);}
  function extractItemsPlainText(items){
    if(!Array.isArray(items))return '';
    return items.map(item=>item?.chunk?.case==='text'?String(item.chunk.value||''):'').join('').trim();
  }
  function userMessageText(element){
    const msg=userMessage(element);
    if(!msg?.step?.items)return '';
    return extractItemsPlainText(msg.step.items).replace(/^\/goal\b\s*/i,'').trim();
  }
  async function cancelInvocation(cascadeId){
    if(!cascadeId)return false;
    try{await (sendService||service())?.cancelCascadeInvocation?.({cascadeId});return true;}catch{return false;}
  }
  async function resumeGoalInvocation(cascadeId,text='继续推进当前目标'){
    if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(cascadeId||''))return false;
    const prompt=String(text||'').trim()||'继续推进当前目标';
    if(pendingEdit?.cascadeId===cascadeId)cancelEdit({restoreDraft:true});
    installRequestOverrides();
    const item=(typeof I==='object'&&I?.TextOrScopeItemSchema&&typeof Wb==='function')
      ?Wb(I.TextOrScopeItemSchema,{chunk:{case:'text',value:prompt}})
      :{chunk:{case:'text',value:prompt}};
    const candidates=typeof document!=='undefined'?[
      ...(document.querySelectorAll?.('.surface-composer-card,[data-testid="agent-input-box"],[data-testid="user-input-step"]')||[]),
      pageSource()
    ].filter(Boolean):[];
    let fallbackChatCtx=null;
    for(const el of candidates){
      const list=providers(el);
      const chatCtx=list.find(p=>typeof p.value?.sendMessage==='function')?.value;
      if(!chatCtx)continue;
      const ctxCid=chatCtx.cascadeContext?.state?.conversationId
        ||list.find(p=>typeof p.value?.cascadeId==='string')?.value?.cascadeId
        ||'';
      if(ctxCid===cascadeId){
        await chatCtx.sendMessage({type:1,cascadeId,items:[item],media:[]});
        return true;
      }
      if(!fallbackChatCtx&&!isNestedComposer(el))fallbackChatCtx=chatCtx;
    }
    if(fallbackChatCtx){
      await fallbackChatCtx.sendMessage({type:1,cascadeId,items:[item],media:[]});
      return true;
    }
    const svc=sendService||service();
    if(typeof svc?.sendUserCascadeMessage==='function'){
      await svc.sendUserCascadeMessage({cascadeId,items:[item]});
      return true;
    }
    return false;
  }
  const stageUpdateRule='During this task, communicate brief visible progress updates in the user-facing response alongside tool calls. Before the first substantial tool action, write one concise sentence explaining the immediate next action and its purpose. After a meaningful finding, change of direction, or a few execution steps, write one or two concise sentences stating the result and next action. These are intermediate updates, not final answers: continue executing the task after each update. Do not narrate every command. Do not put updates only in private thinking, tool summaries, task artifacts, or notify_user. Use the user language. Never invent progress or expose private reasoning.';
  const efficientIORule='Reduce unnecessary model round trips while respecting the task and platform permissions. Locate relevant files and symbols with available purpose-built search tools first; otherwise prefer rg when available, respect ignore rules, and use commands appropriate to the operating system. Batch already-known, independent searches and file reads in the same tool round when supported. Keep dependent operations sequential and honor any user-requested sequence. Read sufficient surrounding code once; read small relevant files whole and bounded regions of large files. Reuse unchanged information. Prefer focused edits that preserve unrelated work. Run the checks appropriate to the change and avoid redundant checks after they pass. Report meaningful milestones rather than narrating every command. Lead the final response with the result; keep detail proportional to the task and honor explicit requests for detailed explanations. Do not assume any fixed command allowlist or promised performance gain.';
  const pragmaticCodingRule='Honor all user-defined rules and explicit instructions first. Practice surgical, high-signal engineering: diagnose root causes in the existing code before editing; make the smallest complete change that solves the task while matching local conventions, types, and abstractions; never refactor unrelated code, add speculative abstractions, introduce silent error-swallowing fallbacks, or write redundant comments explaining obvious lines. After modifying code, run focused verification appropriate to the touched area (such as targeted unit tests or syntax checks) and fix regressions caused by your changes. Keep responses concise and direct: lead with the outcome or answer, cite modified files clearly, and avoid filler preambles or repetitive closing summaries unless detailed explanation is requested.';
  const goalGuardrailRules={
    run_tests:'Run relevant automated tests or verification commands and ensure they pass before declaring completion.',
    minimal_diff:'Make only the smallest necessary surgical changes; do not refactor unrelated code or formatting.',
    no_new_deps:'Do not introduce new third-party dependencies unless explicitly requested.',
    final_summary:'Include a concise summary of modified files and verification results upon completion.'
  };
  function buildGoalPromptRule(goal){
    if(!goal||typeof goal!=='object')return '';
    if(goal.status==='cleared'&&goal.clearedNative){
      return 'The user explicitly cancelled and cleared the previous /goal for this conversation. Include <!-- GOAL_CANCELLED --> in your response and follow only the latest user request.';
    }
    if(goal.status==='paused'&&goal.pausedNative){
      return 'The previous /goal for this conversation is currently paused. Include <!-- GOAL_CANCELLED --> in your response so automatic goal continuation stays paused, and address only the latest user request.';
    }
    if(goal.status==='active'&&goal.text){
      const checks=Array.isArray(goal.checklist)?goal.checklist.filter(it=>it&&typeof it.text==='string'&&it.text.trim()):[];
      const checklistBlock=checks.length?`\n\nAcceptance Checklist (every item must be satisfied before emitting <!-- GOAL_COMPLETE -->):\n${checks.map(it=>`- [${it.done?'x':' '}] ${it.text.trim()}`).join('\n')}`:'';
      const rails=Array.isArray(goal.guardrails)?goal.guardrails.map(id=>goalGuardrailRules[id]).filter(Boolean):[];
      const guardrailBlock=rails.length?`\n\nExecution Guardrails:\n${rails.map(rule=>`- ${rule}`).join('\n')}`:'';
      return `Active Conversation Goal (treat this as the authoritative current objective, superseding any earlier /goal wording if edited):\n<GOAL>\n${goal.text}${checklistBlock}${guardrailBlock}\n</GOAL>\nWork thoroughly until every requirement of this goal is fulfilled. Include <!-- GOAL_COMPLETE --> only when this exact goal is completely satisfied, or <!-- GOAL_CANCELLED --> if cancelled.`;
    }
    return '';
  }
  function activeRouteCascadeId(){
    try{return typeof location!=='undefined'?location.pathname?.match(/^\/c\/([a-zA-Z0-9_-]+)/)?.[1]||'':'';}catch{return '';}
  }
  function configureRequest(base,cascadeId='',inlineImagePromptOverride=null) {
    const config=tc(I.CascadeConfigSchema,base);
    if(contextLimit>0)config.checkpointConfig=Wb(I.CheckpointConfigSchema,{...config.checkpointConfig,maxTokenLimit:contextLimit,tokenThreshold:contextLimit});
    if(stageUpdatesEnabled){
      config.plannerConfig ||= Wb(I.CascadePlannerConfigSchema,{});
      config.plannerConfig.noToolExplanation=false;
      config.plannerConfig.noToolSummary=false;
    }
    const targetCid=cascadeId||activeRouteCascadeId();
    const goalRule=goalBarEnabled&&targetCid?buildGoalPromptRule(conversationGoals.get(targetCid)):'';
    const inlineImageRule=inlineImagesEnabled
      ?(inlineImagePromptOverride!==null?inlineImagePromptOverride:(globalThis.__agyInlineImages?.buildPromptSectionForCascade?.(targetCid)||''))
      :'';
    if(stageUpdatesEnabled||efficientIOEnabled||pragmaticCodingEnabled||goalRule||inlineImageRule){
      config.plannerConfig ||= Wb(I.CascadePlannerConfigSchema,{});
      const prompts=config.plannerConfig.promptSectionCustomizationConfig||Wb(I.PromptSectionCustomizationConfigSchema,{});
      const names=['powertools_stage_updates','powertools_efficient_io','powertools_pragmatic_coding','powertools_active_goal','powertools_inline_images'];
      prompts.appendPromptSections=[...(prompts.appendPromptSections||[]).filter(p=>!names.includes(p.title)),
        ...(stageUpdatesEnabled?[Wb(I.PromptSectionSchema,{title:names[0],content:stageUpdateRule})]:[]),
        ...(efficientIOEnabled?[Wb(I.PromptSectionSchema,{title:names[1],content:efficientIORule})]:[]),
        ...(pragmaticCodingEnabled?[Wb(I.PromptSectionSchema,{title:names[2],content:pragmaticCodingRule})]:[]),
        ...(goalRule?[Wb(I.PromptSectionSchema,{title:names[3],content:goalRule})]:[]),
        ...(inlineImageRule?[Wb(I.PromptSectionSchema,{title:names[4],content:inlineImageRule})]:[])];
      config.plannerConfig.promptSectionCustomizationConfig=prompts;
    }
    return config;
  }
  function hasActiveGoalOverrides(){
    if(!goalBarEnabled||!conversationGoals.size)return false;
    for(const g of conversationGoals.values()){
      if((g?.status==='active'&&g.text)||(g?.status==='cleared'&&g.clearedNative)||(g?.status==='paused'&&g.pausedNative))return true;
    }
    return false;
  }
  function detectOutgoingGoal(payload){
    if(!goalBarEnabled||!payload?.cascadeId)return null;
    const raw=extractItemsPlainText(payload.items);
    const hasSlash=/^\/goal(?:\s|$)/i.test(raw)||(Array.isArray(payload.items)&&payload.items.some(it=>it?.chunk?.case==='slashCommand'&&/goal/i.test(String(it.chunk.value?.name||it.chunk.value||''))));
    if(!hasSlash)return null;
    const cleanText=raw.replace(/^\/goal\b\s*/i,'').trim()||'目标任务';
    const priorExec=executionState(payload.cascadeId);
    const activeAfterStepIndex=Math.max(priorExec?.lastStepIndex??-1,priorExec?.turnStartStepIndex??-1);
    const now=Date.now();
    const optimistic={text:cleanText,status:'active',startedAtMs:now,updatedAtMs:now,activeAfterStepIndex,custom:false,optimistic:true};
    conversationGoals.set(payload.cascadeId,optimistic);
    for(const fn of goalDetectListeners){try{fn(payload.cascadeId,optimistic);}catch{}}
    return optimistic;
  }
  function installRequestOverrides(source){
    if (!sendService) {
      try {
        const candidate=service(source);
        if(candidate){ sendService=candidate; originalSend=sendService.sendUserCascadeMessage; }
      } catch { /* Conversation service may not be mounted yet (e.g. cold start or non-conversation route). */ }
    }
    const hasConfigOverride=contextLimit>0||stageUpdatesEnabled||efficientIOEnabled||pragmaticCodingEnabled||inlineImagesEnabled||hasActiveGoalOverrides();
    if(typeof globalThis[hookNames.resolve]==='function'){
      originalResolve ||= globalThis[hookNames.resolve];
      globalThis[hookNames.resolve]=runtimeEnabled&&hasConfigOverride?function(...args){return configureRequest(originalResolve(...args));}:originalResolve;
    }
    if(sendService&&originalSend){
      wrappedSend ||= async function(payload,...args){
        const detectedGoal=runtimeEnabled?detectOutgoingGoal(payload):null;
        const pauseDetectedOnError=error=>{
          if(detectedGoal&&payload?.cascadeId&&conversationGoals.get(payload.cascadeId)===detectedGoal){
            const paused={...detectedGoal,status:'paused',pausedElapsedMs:Math.max(0,Date.now()-(detectedGoal.startedAtMs||Date.now())),updatedAtMs:Date.now()};
            conversationGoals.delete(payload.cascadeId);
            for(const fn of goalDetectListeners){try{fn(payload.cascadeId,paused);}catch{}}
          }
          throw error;
        };
        const inlinePrepared=runtimeEnabled&&inlineImagesEnabled
          ?globalThis.__agyInlineImages?.prepareOutgoingPayload?.(payload)
          :null;
        const outgoing=inlinePrepared?.payload||payload;
        const inlinePrompt=inlinePrepared?.promptSection||'';
        const edit=runtimeEnabled&&pendingEdit&&outgoing?.cascadeId===pendingEdit.cascadeId?pendingEdit:null;
        const activeConfigOverride=runtimeEnabled&&(contextLimit>0||stageUpdatesEnabled||efficientIOEnabled||pragmaticCodingEnabled||hasActiveGoalOverrides()||Boolean(inlinePrompt));
        if(edit){
          pendingEdit=null;suspendedEdits.delete(edit.cascadeId);restoreComposerHome(edit);installRequestOverrides();notifyEdit();
          const optimisticRevert=edit.optimistic?.applyOptimisticRevert?.(edit.cascadeId,edit.stepIndex-1);
          try{
            await (sendService||service()).cancelCascadeInvocation?.({cascadeId:edit.cascadeId}).catch(()=>{});
            await edit.stepHandler.revertToIndex(edit.cascadeId,edit.stepIndex-1,{conversationOnly:true});
            const nextPayload={
              ...outgoing,
              ...(outgoing.artifactComments?.length?{}:{artifactComments:edit.comments.artifactComments}),
              ...(outgoing.fileDiffComments?.length?{}:{fileDiffComments:edit.comments.fileDiffComments}),
              ...(outgoing.fileComments?.length?{}:{fileComments:edit.comments.fileComments}),
              cascadeConfig:activeConfigOverride?configureRequest(Wb(I.CascadeConfigSchema,outgoing.cascadeConfig||{}),outgoing?.cascadeId,inlinePrompt):outgoing.cascadeConfig
            };
            delete nextPayload.deliveryStrategy;
            const res=await originalSend.call(this,nextPayload,...args);
            globalThis.__agyInlineImages?.onMessageSent?.(outgoing?.cascadeId);
            return res;
          }catch(error){
            pauseDetectedOnError(error);
          }finally{optimisticRevert?.dispose?.();}
        }
        const configured=activeConfigOverride?{...outgoing,cascadeConfig:configureRequest(Wb(I.CascadeConfigSchema,outgoing.cascadeConfig||{}),outgoing?.cascadeId,inlinePrompt)}:outgoing;
        try{
          const res=await originalSend.call(this,configured,...args);
          globalThis.__agyInlineImages?.onMessageSent?.(outgoing?.cascadeId);
          return res;
        }catch(error){
          pauseDetectedOnError(error);
        }
      };
      sendService.sendUserCascadeMessage=runtimeEnabled?wrappedSend:originalSend;
    }
  }
  function ensureRequestHook(source){
    if(!runtimeEnabled)return;
    try{installRequestOverrides(source);}catch{}
  }
  function setContextLimit(limit) {
    if (![0,256000,500000,1000000].includes(limit)) throw new Error('不支持的上下文上限');
    contextLimit=limit;installRequestOverrides();
  }
  function setEfficientIO(enabled){efficientIOEnabled=enabled===true;installRequestOverrides();}
  function setPragmaticCoding(enabled){pragmaticCodingEnabled=enabled===true;installRequestOverrides();}
  function setGoalBar(enabled){goalBarEnabled=enabled===true;installRequestOverrides();}
  function setInlineImages(enabled){inlineImagesEnabled=enabled===true;globalThis.__agyInlineImages?.setEnabled?.(runtimeEnabled&&inlineImagesEnabled);installRequestOverrides();}
  function setInlineImagesLanguage(lang){globalThis.__agyInlineImages?.setLanguage?.(lang);}
  function setConversationGoal(cascadeId,goal){
    if(!cascadeId)return;
    if(!goal||(goal.status!=='active'&&!(goal.status==='cleared'&&goal.clearedNative)&&!(goal.status==='paused'&&goal.pausedNative))){
      conversationGoals.delete(cascadeId);
    }else{
      conversationGoals.set(cascadeId,goal);
    }
    try{installRequestOverrides();}catch{}
  }
  function refreshSidebarList(){
    try{
      const nav=document.querySelector('[role="navigation"][aria-label="Sidebar"],[role="navigation"][data-agy-original-aria-label="Sidebar"]')
        ||document.querySelector('[role="navigation"][aria-label="侧边栏"],[role="navigation"][aria-label="側邊欄"]');
      if(!nav)return;
      const root=fiber(nav);
      if(!root)return;
      const seen=new Set(),stack=[root];
      while(stack.length){
        const node=stack.pop();
        if(!node||seen.has(node))continue;
        seen.add(node);
        for(let h=node.memoizedState;h&&typeof h==='object';h=h.next){
          if(h.memoizedState&&typeof h.memoizedState==='object'&&'onlyShowFirstFewConvos' in h.memoizedState&&typeof h.queue?.dispatch==='function'){
            h.queue.dispatch(prev=>prev?{...prev}:{onlyShowFirstFewConvos:{}});
            return;
          }
        }
        if(node.child)stack.push(node.child);
        if(node.sibling)stack.push(node.sibling);
      }
    }catch{/* Best effort refresh. */}
  }
  let pinStorage=null,stopPinStorageWatch=null;
  // Reads the client's usePersistentState backing store synchronously; storage changes re-render the sidebar instead of a hook subscription.
  function persistedSidebarValue(key){
    if(!pinStorage){
      pinStorage=providers(pageSource()).map(p=>p.value?.core?.storageService).find(s=>typeof s?.get==='function')||null;
      if(pinStorage&&typeof pinStorage.onDidChange==='function')stopPinStorageWatch=pinStorage.onDidChange(changes=>{if(changes&&('pinnedProjectIds' in changes||'pinned_workspace_row_order' in changes))refreshSidebarList();});
    }
    try{const raw=pinStorage?.get(key);return typeof raw==='string'?JSON.parse(raw):raw;}catch{return undefined;}
  }
  function reorderPinnedSectionItems(items){
    if(!Array.isArray(items)||!items.length)return items;
    const startIdx=items.findIndex(it=>it?.type==='section-header'&&it.id==='section-pinned');
    if(startIdx<0)return items;
    let endIdx=items.length;
    for(let i=startIdx+1;i<items.length;i++){
      const cur=items[i];
      if((cur?.type==='spacer'&&cur.id==='spacer-section-pinned')||cur?.type==='section-header'){endIdx=i;break;}
    }
    if(endIdx<=startIdx+2)return items;
    const looseRows=[],folderBlocks=[];
    for(let i=startIdx+1;i<endIdx;i++){
      const cur=items[i];
      if(cur?.type==='row'&&cur.groupId==='pinned'&&!cur.folderId&&!cur.isIndented)looseRows.push(cur);
      else folderBlocks.push(cur);
    }
    if(!looseRows.length||!folderBlocks.length)return items;
    return [...items.slice(0,startIdx+1),...looseRows,...folderBlocks,...items.slice(endIdx)];
  }
  let btwSubtreeEnabled=false,btwFoldedSet=new Set(),btwDetachedSet=new Set(),btwDiskMeta={};
  let syncingProjectMoves=false,hydratingBtw=false;
  const activeProjectMoveRequests=new Map();
  const syncedBtwSummarySig=new Map();
  function normalizeProjectTarget(raw){
    const val=typeof raw==='string'?raw.trim():'';
    return !val||val==='standalone'||val==='outside-of-project'?'outside-of-project':val;
  }
  function makeProtoTimestamp(sec,sampleTs=null){
    const nSec=Math.floor(Number(sec)||0);
    if(nSec<=0)return undefined;
    if(sampleTs&&typeof sampleTs==='object'){
      const proto=Object.getPrototypeOf(sampleTs);
      const next=proto?Object.create(proto):{};
      return Object.assign(next,sampleTs,{seconds:typeof sampleTs.seconds==='bigint'?BigInt(nSec):nSec,nanos:0});
    }
    return {seconds:typeof BigInt==='function'?BigInt(nSec):nSec,nanos:0};
  }
  // Pure read-only snapshot safe to call inside wrappedSidebarItems during React render
  function btwTreeSnapshot(){
    const s=store()?.getState?.();
    const summaries=s?.trajectorySummaries?.summaries;
    if(!summaries||typeof summaries!=='object')return {parentByChild:{},childrenByParent:{},titlesByChild:{}};
    const extSummaries=s?.trajectorySummaries?.externalSummaries||{};
    const ephemeral=s?.ephemeralFork?.forks||{};
    const sideViews=s?.sidePanelV2?.viewsByTreeKey||{};
    const directParent={};
    const rawOrder=new Map();
    const pushOrder=(pid,cid)=>{
      if(!rawOrder.has(pid))rawOrder.set(pid,[]);
      const arr=rawOrder.get(pid);
      if(!arr.includes(cid))arr.push(cid);
    };
    for(const [pid,sum] of Object.entries(summaries)){
      const ids=sum?.annotations?.sideQuestionCascadeIds;
      if(!Array.isArray(ids)||!ids.length)continue;
      for(const cid of ids){
        if(!cid||cid===pid||btwDetachedSet.has(cid))continue;
        directParent[cid]=pid;
        pushOrder(pid,cid);
      }
    }
    for(const [cid,meta] of Object.entries(btwDiskMeta)){
      const pid=meta?.parentId;
      if(!cid||!pid||cid===pid||btwDetachedSet.has(cid)||directParent[cid])continue;
      directParent[cid]=pid;
      pushOrder(pid,cid);
    }
    for(const [cid,fork] of Object.entries(ephemeral)){
      const pid=fork?.parentConversationId;
      if(!cid||!pid||cid===pid||btwDetachedSet.has(cid)||directParent[cid])continue;
      directParent[cid]=pid;
      pushOrder(pid,cid);
    }
    for(const view of Object.values(sideViews)){
      const allTabs=[...(view?.tabs||[]),...((view?.closedTabs||[]).map(t=>t?.tab))];
      for(const tab of allTabs){
        if(tab?.content?.type!=='sideQuestionView')continue;
        const {cascadeId:cid,parentCascadeId:pid}=tab.content.sideQuestionView||{};
        if(!cid||!pid||cid===pid||btwDetachedSet.has(cid)||directParent[cid])continue;
        directParent[cid]=pid;
        pushOrder(pid,cid);
      }
    }
    const parentByChild={},childrenByParent={},titlesByChild={};
    const resolveTop=cid=>{
      let cur=directParent[cid]||'',hops=0;
      const seen=new Set([cid]);
      while(cur&&directParent[cur]&&!seen.has(directParent[cur])&&hops++<6){
        seen.add(cur);
        cur=directParent[cur];
      }
      return cur;
    };
    for(const cid of Object.keys(directParent)){
      const immediate=directParent[cid];
      const top=resolveTop(cid);
      if(!top||!summaries[top])continue;
      const listedOnParent=Array.isArray(summaries[immediate]?.annotations?.sideQuestionCascadeIds)
        &&summaries[immediate].annotations.sideQuestionCascadeIds.includes(cid);
      if(!summaries[cid]&&!extSummaries[cid]&&!ephemeral[cid]&&!btwDiskMeta[cid]&&!listedOnParent)continue;
      parentByChild[cid]=top;
      if(!childrenByParent[top])childrenByParent[top]=[];
      if(!childrenByParent[top].includes(cid))childrenByParent[top].push(cid);
      const rawTitle=String(
        summaries[cid]?.annotations?.title
        ||summaries[top]?.annotations?.sideQuestionTitles?.[cid]
        ||summaries[immediate]?.annotations?.sideQuestionTitles?.[cid]
        ||btwDiskMeta[cid]?.title
        ||ephemeral[cid]?.question
        ||''
      ).replace(/\s+/g,' ').trim();
      if(rawTitle)titlesByChild[cid]=rawTitle;
    }
    for(const [top,list] of Object.entries(childrenByParent)){
      const explicit=rawOrder.get(top)||[];
      list.sort((a,b)=>{
        const ia=explicit.indexOf(a),ib=explicit.indexOf(b);
        if(ia>=0&&ib>=0)return ia-ib;
        if(ia>=0)return -1;
        if(ib>=0)return 1;
        const ta=Number(summaries[a]?.createdTime?.seconds||btwDiskMeta[a]?.createdAtSec||0);
        const tb=Number(summaries[b]?.createdTime?.seconds||btwDiskMeta[b]?.createdAtSec||0);
        return (ta-tb)||a.localeCompare(b);
      });
    }
    return {parentByChild,childrenByParent,titlesByChild};
  }
  // Hydrates SIDE_QUESTION entries into Redux summaries via applyStreamBatch so SidebarRow renders
  // the backend AI-generated overview title + accurate relative timestamp (41m, 6h) with IDLE status.
  function hydrateBtwSummaries(metaOverride=null){
    if(metaOverride&&typeof metaOverride==='object')btwDiskMeta={...btwDiskMeta,...metaOverride};
    if(hydratingBtw)return 0;
    const st=store();
    if(!st?.dispatch)return 0;
    const s=st.getState?.();
    const summaries=s?.trajectorySummaries?.summaries;
    if(!summaries||typeof summaries!=='object')return 0;
    const extSummaries=s?.trajectorySummaries?.externalSummaries||{};
    const snap=btwTreeSnapshot();
    const sampleTs=Object.values(summaries).find(v=>v?.lastModifiedTime)?.lastModifiedTime||null;
    const updates=[];
    for(const [cid,parentId] of Object.entries(snap.parentByChild)){
      const parentSum=summaries[parentId];
      const existing=summaries[cid]||extSummaries[cid]||null;
      const disk=btwDiskMeta[cid]||{};
      const title=String(
        existing?.annotations?.title
        ||snap.titlesByChild[cid]
        ||disk.title
        ||''
      ).replace(/\s+/g,' ').trim();
      const updatedSec=Number(existing?.lastModifiedTime?.seconds||disk.updatedAtSec||parentSum?.lastModifiedTime?.seconds||0);
      const createdSec=Number(existing?.createdTime?.seconds||disk.createdAtSec||updatedSec||0);
      const exec=executionState(cid);
      const running=Boolean(exec&&[2,4].includes(exec.status))||existing?.status===2||existing?.status===4;
      const status=running?2:1;
      const stepCount=Number(existing?.stepCount||disk.stepCount||1);
      const sig=`${title}|${updatedSec}|${status}|${Boolean(summaries[cid])}`;
      if(syncedBtwSummarySig.get(cid)===sig&&summaries[cid])continue;
      const tsUpdated=existing?.lastModifiedTime||(updatedSec>0?makeProtoTimestamp(updatedSec,sampleTs):undefined);
      const tsCreated=existing?.createdTime||(createdSec>0?makeProtoTimestamp(createdSec,sampleTs):undefined);
      const annPayload={
        ...(existing?.annotations||{}),
        ...(title?{title}:{}),
        ...(tsUpdated&&!existing?.annotations?.lastUserViewTime?{lastUserViewTime:tsUpdated}:{})
      };
      const createProto=(typeof If==='object'&&If&&typeof ic==='function')
        ?[If,ic]
        :(typeof YF==='object'&&YF&&typeof Wb==='function'?[YF,Wb]:null);
      const annObj=createProto&&createProto[0].ConversationAnnotationsSchema
        ?createProto[1](createProto[0].ConversationAnnotationsSchema,annPayload)
        :annPayload;
      const baseFields={
        summary:title||(existing?.summary||''),
        stepCount,
        status,
        notFullyIdle:false,
        trajectoryType:22,
        source:0,
        workspaces:existing?.workspaces||parentSum?.workspaces||[],
        waitingSteps:existing?.waitingSteps||[],
        annotations:annObj,
        ...(tsUpdated?{lastModifiedTime:tsUpdated,lastUserInputTime:existing?.lastUserInputTime||tsUpdated}:{}),
        ...(tsCreated?{createdTime:tsCreated}:{}),
        ...(parentSum?.trajectoryMetadata?{trajectoryMetadata:parentSum.trajectoryMetadata}:{})
      };
      const summaryProto=createProto&&createProto[0].CascadeTrajectorySummarySchema
        ?createProto[1](createProto[0].CascadeTrajectorySummarySchema,baseFields)
        :baseFields;
      updates.push([cid,summaryProto,sig]);
    }
    if(updates.length){
      hydratingBtw=true;
      for(const [id,,sig] of updates)syncedBtwSummarySig.set(id,sig);
      try{
        st.dispatch({
          type:'trajectorySummaries/applyStreamBatch',
          payload:{updates:updates.map(([id,proto])=>[id,proto]),deletes:[]}
        });
      }catch{
        for(const [id] of updates)syncedBtwSummarySig.delete(id);
      }finally{
        hydratingBtw=false;
      }
    }
    return updates.length;
  }
  function injectBtwChildRows(items,args){
    if(!Array.isArray(items)||!items.length)return items;
    const snap=btwTreeSnapshot();
    const parentsWithChildren=Object.keys(snap.childrenByParent);
    if(!parentsWithChildren.length)return items;
    const summaries=store()?.getState?.()?.trajectorySummaries?.summaries||{};
    const archivedOnly=Boolean(args?.archivedOnly);
    const activeId=activeRouteCascadeId();
    const activeParentId=activeId?snap.parentByChild[activeId]||'':'';
    let working=items;
    // Keep the parent of an active /btw child visible even when collapsed under "See all"
    if(activeParentId&&!working.some(it=>it?.type==='row'&&it.cascadeId===activeParentId)&&Array.isArray(args?.groups)){
      const ownerGroup=args.groups.find(g=>Array.isArray(g?.items)&&g.items.some(x=>x?.cascadeId===activeParentId));
      if(ownerGroup?.id){
        const showMoreIdx=working.findIndex(it=>it?.type==='show-more'&&it.groupId===ownerGroup.id);
        if(showMoreIdx>=0){
          working=[
            ...working.slice(0,showMoreIdx),
            {type:'row',id:activeParentId,cascadeId:activeParentId,isIndented:ownerGroup.id!=='standalone',groupId:ownerGroup.id},
            ...working.slice(showMoreIdx)
          ];
        }
      }
    }
    const out=[];
    for(const item of working){
      out.push(item);
      if(item?.type!=='row'||!item.cascadeId||snap.parentByChild[item.cascadeId])continue;
      const children=snap.childrenByParent[item.cascadeId];
      if(!children?.length)continue;
      const folded=btwFoldedSet.has(item.cascadeId);
      if(folded)continue;
      for(const sqId of children){
        const sqSum=summaries[sqId];
        if(sqSum?Boolean(sqSum.annotations?.archived)!==archivedOnly:archivedOnly)continue;
        const rowKey=item.groupId==='pinned'?`${sqId}__pinned`:sqId;
        out.push({
          type:'row',
          id:rowKey,
          cascadeId:sqId,
          isIndented:Boolean(item.isIndented),
          groupId:item.groupId,
          ...(item.folderId?{folderId:item.folderId}:{}),
          agyAside:true,
          agyParentId:item.cascadeId
        });
      }
    }
    return out;
  }
  function setBtwSubtree(enabled){
    const next=enabled===true;
    const changed=btwSubtreeEnabled!==next;
    btwSubtreeEnabled=next;
    syncSidebarHooks();
    if(changed)refreshSidebarList();
  }
  function setBtwTreeState({foldedIds,detachedIds,btwMeta}={}){
    let changed=false;
    if(Array.isArray(foldedIds)){
      const nextFolded=new Set(foldedIds.filter(validCascadeId));
      if(nextFolded.size!==btwFoldedSet.size||[...nextFolded].some(id=>!btwFoldedSet.has(id))){
        btwFoldedSet=nextFolded;
        changed=true;
      }
    }
    if(Array.isArray(detachedIds)){
      const nextDetached=new Set(detachedIds.filter(validCascadeId));
      if(nextDetached.size!==btwDetachedSet.size||[...nextDetached].some(id=>!btwDetachedSet.has(id))){
        btwDetachedSet=nextDetached;
        changed=true;
      }
    }
    if(btwMeta&&typeof btwMeta==='object'){
      btwDiskMeta={...btwDiskMeta,...btwMeta};
      changed=true;
    }
    if(changed&&btwSubtreeEnabled)refreshSidebarList();
  }
  function syncSidebarHooks(){
    const itemsName=hookNames.sidebarItems;
    if(itemsName&&typeof globalThis[itemsName]==='function'){
      originalSidebarItems ||= globalThis[itemsName];
      wrappedSidebarItems ||= function(args){
        let res;
        if(!runtimeEnabled||sidebarProjectLimit===0||!args||args.groupBy==='none'||!Array.isArray(args.groups)){
          res=originalSidebarItems(args);
        }else{
          const origFlags=args.onlyShowFirstFewConvos||{};
          const allExpanded={...origFlags};
          for(const g of args.groups)if(g?.id&&g.id!=='standalone')allExpanded[g.id]=false;
          const full=originalSidebarItems({...args,onlyShowFirstFewConvos:allExpanded});
          const totals=new Map();
          for(const g of args.groups)if(g?.id&&g.id!=='standalone')totals.set(g.id,Array.isArray(g.items)?g.items.length:0);
          if(!Array.isArray(full))res=full;
          else if(sidebarProjectLimit===-1)res=full.filter(item=>!(item?.type==='show-more'&&totals.has(item.groupId)));
          else{
            const out=[],seen=new Map();
            for(let i=0;i<full.length;i++){
              const item=full[i];
              if(item?.type==='show-more'&&totals.has(item.groupId))continue;
              if(item?.type==='row'&&item.isIndented&&totals.has(item.groupId)){
                const gid=item.groupId,total=totals.get(gid),collapsed=origFlags[gid]??true;
                const idx=seen.get(gid)||0;seen.set(gid,idx+1);
                if(!collapsed||idx<sidebarProjectLimit)out.push(item);
                const nextItem=full[i+1];
                const isLastOfGroup=!nextItem||nextItem.type!=='row'||!nextItem.isIndented||nextItem.groupId!==gid;
                if(isLastOfGroup&&total>sidebarProjectLimit){
                  out.push({type:'show-more',id:`show-more-${gid}`,label:collapsed?`See all (${total})`:'See less',groupId:gid,isIndented:true});
                }
                continue;
              }
              out.push(item);
            }
            res=out;
          }
        }
        const pinnedOrdered=runtimeEnabled&&sidebarProjectPinEnabled?reorderPinnedSectionItems(res):res;
        return runtimeEnabled&&btwSubtreeEnabled?injectBtwChildRows(pinnedOrdered,args):pinnedOrdered;
      };
      globalThis[itemsName]=runtimeEnabled&&(sidebarProjectLimit!==0||sidebarProjectPinEnabled||btwSubtreeEnabled)?wrappedSidebarItems:originalSidebarItems;
    }
    const dataName=hookNames.sidebarData;
    if(dataName&&typeof globalThis[dataName]==='function'){
      originalSidebarData ||= globalThis[dataName];
      // No React hooks here: this hook is swapped in after the sidebar may have mounted, and extra hooks crash it (React #311 white screen).
      wrappedSidebarData ||= function(args){
        const pinned=runtimeEnabled&&sidebarProjectPinEnabled&&args&&args.includePinnedSection&&!args.archivedOnly&&(!Array.isArray(args.pinnedProjectIds)||args.pinnedProjectIds.length===0)?persistedSidebarValue('pinnedProjectIds'):null;
        if(Array.isArray(pinned)){
          const order=persistedSidebarValue('pinned_workspace_row_order');
          return originalSidebarData.call(this,{
            ...args,
            pinnedProjectIds:[...new Set(pinned.filter(id=>typeof id==='string'))],
            pinnedConversationProjectIds:args.pinnedConversationProjectIds??{},
            pinnedWorkspaceRowOrder:args.pinnedWorkspaceRowOrder??(order&&typeof order==='object'&&!Array.isArray(order)?order:{})
          });
        }
        return originalSidebarData.call(this,args);
      };
      globalThis[dataName]=runtimeEnabled&&sidebarProjectPinEnabled?wrappedSidebarData:originalSidebarData;
    }
    const headerName=hookNames.projectHeader;
    if(headerName&&typeof globalThis[headerName]==='function'){
      originalProjectHeader ||= globalThis[headerName];
      wrappedProjectHeader ||= function(props){
        const usePinnedIds=hookNames.pinnedProjectsHook?globalThis[hookNames.pinnedProjectsHook]:null;
        const useTogglePin=hookNames.togglePinProjectHook?globalThis[hookNames.togglePinProjectHook]:null;
        const pinnedPair=typeof usePinnedIds==='function'?usePinnedIds():null;
        const togglePin=typeof useTogglePin==='function'?useTogglePin():null;
        if(!runtimeEnabled||!sidebarProjectPinEnabled||!props?.projectId||props.onTogglePin||!Array.isArray(pinnedPair?.[0])||typeof togglePin!=='function'){
          return originalProjectHeader.call(this,props);
        }
        const isPinned=pinnedPair[0].includes(props.projectId);
        return originalProjectHeader.call(this,{
          ...props,
          isPinned,
          onTogglePin:togglePin,
          ...(isPinned&&!props.isPinned?{onPointerDown:undefined}:{})
        });
      };
      globalThis[headerName]=runtimeEnabled&&sidebarProjectPinEnabled?wrappedProjectHeader:originalProjectHeader;
    }
  }
  function setSidebarProjectLimit(limit){
    const next=[0,1,2,3,4,5,10,-1].includes(limit)?limit:0;
    const changed=sidebarProjectLimit!==next;
    sidebarProjectLimit=next;
    syncSidebarHooks();
    if(changed)refreshSidebarList();
  }
  function setSidebarProjectPin(enabled){
    const next=enabled===true;
    const changed=sidebarProjectPinEnabled!==next;
    sidebarProjectPinEnabled=next;
    syncSidebarHooks();
    if(changed)refreshSidebarList();
  }
  function useConversationProjectPin(cascadeId){
    const usePinnedIds=hookNames.pinnedProjectsHook?globalThis[hookNames.pinnedProjectsHook]:null;
    const useTogglePin=hookNames.togglePinProjectHook?globalThis[hookNames.togglePinProjectHook]:null;
    if(typeof usePinnedIds!=='function'||typeof useTogglePin!=='function')return null;
    const pinnedPair=usePinnedIds();
    const togglePin=useTogglePin();
    if(!runtimeEnabled||!sidebarProjectPinEnabled||!cascadeId||!Array.isArray(pinnedPair?.[0])||typeof togglePin!=='function')return null;
    const summary=store()?.getState?.()?.trajectorySummaries?.summaries?.[cascadeId];
    const projectId=String(summary?.trajectoryMetadata?.projectId||summary?.projectId||'').trim();
    if(!projectId||projectId==='outside-of-project')return null;
    return {projectId,pinned:pinnedPair[0].includes(projectId),toggle:()=>togglePin(projectId)};
  }
  function setEnabled(enabled){const prev=runtimeEnabled;runtimeEnabled=enabled!==false;if(!runtimeEnabled){cancelEdit();suspendedEdits.clear();}globalThis.__agyInlineImages?.setEnabled?.(runtimeEnabled&&inlineImagesEnabled);setStageUpdates(stageUpdatesEnabled);syncSidebarHooks();if(prev!==runtimeEnabled)refreshSidebarList();}
  function setStageUpdates(enabled){
    stageUpdatesEnabled=enabled===true;installRequestOverrides();
    if(typeof globalThis[hookNames.segment]==='function'){
      originalSegmentRender ||= globalThis[hookNames.segment];
      stageSegmentRender ||= function(...args){
        const result=originalSegmentRender(...args);
        if(!runtimeEnabled||!stageUpdatesEnabled||result?.body?.type!=='collapsible')return result;
        const groups=result.body.content?.groups||[];
        const isUpdate=g=>g.type==='step'&&g.step?.step?.case==='plannerResponse'&&g.step.step.value?.response?.trim();
        const leading=result.leadingSteps||[],updates=leading.filter(isUpdate);
        if(!updates.length&&!groups.some(isUpdate))return result;
        // While running, retain native text/tool order without the outer fold.
        // On completion, move the leading updates into that fold as well.
        // The native tail contains the final answer and stays outside it.
        const active=result.body.isActive||args[0]?.isRunning&&args[0]?.isLastTurn&&args[0]?.segment?.isLatest;
        if(active)return{...result,body:{type:'inline',content:result.body.content}};
        return{...result,leadingSteps:leading.filter(g=>!isUpdate(g)),body:{...result.body,
          defaultExpanded:false,isActive:false,triggerVisible:true,
          content:{...result.body.content,groups:[...updates,...groups]}}};
      };
      globalThis[hookNames.segment]=runtimeEnabled&&stageUpdatesEnabled?stageSegmentRender:originalSegmentRender;
    }
  }
  function installPage(component) {
    const r=router(); if (!r || typeof VD!=='function') return false;
    const onPowertools=typeof location!=='undefined'&&location.pathname==='/powertools';
    const existing=r.routesById?.['/manager-layout/manager-landing-layout/powertools'];
    if (existing) {
      existing.update({component});
      if(onPowertools)void r.navigate({to:'/customizations',replace:true}).then(()=>r.navigate({to:'/powertools',replace:true}));
      return true;
    }
    if(!onPowertools&&(r.state?.isLoading||r.state?.status==='pending'||r.state?.pendingMatches?.length))return false;
    const parent=r.routesById?.['/manager-layout/manager-landing-layout'];
    if (!parent) return false;
    const pending=parent.children.find(route=>route.options.path==='/powertools');
    if(pending)pending.update({component});else parent.addChildren([...parent.children,VD({getParentRoute:()=>parent,path:'/powertools',component})]);
    r.routeTree = null;
    r.update({routeTree:r.options.routeTree});
    if(onPowertools||(Array.isArray(r.state?.matches)&&!r.state.matches.length))void r.load();
    return true;
  }
  // The reply after the last tool call is the final answer; earlier planner text is progress chatter.
  function finalResponseFromSteps(steps) {
    let trailing = [], lastText = '';
    for (const item of Array.isArray(steps) ? steps : []) {
      const c = item?.step?.case, v = item?.step?.value;
      if (!c || ['userInput', 'systemMessage', 'checkpoint', 'ephemeralMessage'].includes(c)) continue;
      const text = String(c === 'plannerResponse' ? (v?.modifiedResponse || v?.response || '') : c === 'notifyUser' ? (v?.message || '') : '').trim();
      if (text) lastText = text;
      const resets = c === 'plannerResponse' ? Boolean(v?.toolCalls?.length) : c !== 'notifyUser';
      if (resets) trailing = [];
      else if (text) trailing.push(text);
    }
    return (trailing.length ? trailing.join('\n\n') : lastText).trim();
  }
  function finalResponseText(element) {
    for (let node = fiber(element); node; node = node.return) {
      const steps = node.memoizedProps?.steps;
      if (Array.isArray(steps) && steps.length) return finalResponseFromSteps(steps);
    }
    return '';
  }
  function userMessage(element) {
    for (let node = fiber(element); node; node = node.return) {
      const props = node.memoizedProps;
      if (props?.step?.items && props.metadata && props.cascadeId) return props;
    }
    return null;
  }
  function navigateTurn(turn) {
    const source=document.querySelector('[data-testid="user-input-step"],[data-testid="agent-response"]');
    const nav=providers(source).find(p=>typeof p.value?.jumpTo==='function'&&Array.isArray(p.value.turns))?.value;
    const index=nav?.turns.findIndex(item=>item.startStepIndex===turn.stepIndexStart)??-1;
    if(index>=0){nav.jumpTo(index);return true;}
    for(const element of document.querySelectorAll('[data-testid="user-input-step"]')){
      const message=userMessage(element);
      if(message&&HU(message.metadata)===turn.stepIndexStart){element.scrollIntoView({behavior:'smooth',block:'start'});return true;}
    }
    return false;
  }
  function replaceText(items, text) {
    let inserted = false;
    const result = items.flatMap(item => {
      if (item.chunk?.case !== 'text') return [item];
      if (inserted) return [];
      inserted = true;
      return [{ ...item, chunk: { case: 'text', value: text } }];
    });
    if (!inserted) result.unshift({ chunk: { case: 'text', value: text } });
    return result;
  }
  async function editAndResend(element, text) {
    if (!text.trim()) throw new Error('请输入消息');
    const message = userMessage(element);
    const context = providers(element).find(p => typeof p.value?.sendMessage === 'function' && p.value?.stepHandler)?.value;
    if (!message || !context?.stepHandler?.revertToIndex) throw new Error('当前消息不支持编辑');
    const stepIndex = HU(message.metadata);
    const items = replaceText(message.step.items, text);
    let reverted = false;
    try {
      // This option explicitly preserves workspace files.
      await context.stepHandler.revertToIndex(message.cascadeId, stepIndex - 1, { conversationOnly: true });
      reverted = true;
      await context.sendMessage({ type: 1, cascadeId: message.cascadeId, items, media: message.step.media || [], resend: 'edit',
        commentOverrides: { artifactComments: message.step.artifactComments || [], fileDiffComments: message.step.fileDiffComments || [], fileComments: message.step.fileComments || [] } });
      return { conversationId: message.cascadeId, replacedStepIndex: stepIndex };
    } catch (error) {
      if (reverted) {
        const box = context.inputBoxRef?.current;
        const editor = box?.lexicalRef?.current;
        if (editor && typeof IJ === 'function' && typeof LN === 'function') {
          editor.setEditorState(IJ(editor, LN(items)));
          box.setMediaAttachments?.(message.step.media || []);
        }
      }
      throw error;
    }
  }
  async function forkPoint(conversationId, stepIndex) {
    if (stepIndex === -1) return -1;
    const data = await service().getCascadeTrajectory({ cascadeId: conversationId });
    const steps = data.trajectory.steps;
    const next = steps.find(step => HU(step.metadata) > stepIndex && step.step?.case === 'userInput');
    return next ? HU(next.metadata) - 1 : -1;
  }
  function nextBranchTitle(sourceTitle, existingTitles = []) {
    const base = String(sourceTitle || '').trim().replace(/\s*\(\d+\)$/, '').trim() || '分支会话';
    const taken = new Set((existingTitles || []).map(item => String(item || '').trim()).filter(Boolean));
    let index = 1;
    while (taken.has(`${base} (${index})`)) index++;
    return `${base} (${index})`;
  }
  async function renameForkedConversation(sourceId, newId, fallbackTitle = '') {
    if (!sourceId || !newId || sourceId === newId) return null;
    const svc = service();
    if (typeof svc.updateConversationAnnotations !== 'function') return null;
    const map = store()?.getState()?.trajectorySummaries?.summaries || {};
    const sourceEntry = map[sourceId];
    const domSourceTitle = typeof document !== 'undefined'
      ? document.querySelector?.(`a[href="/c/${sourceId}"],a[href^="/c/${sourceId}?"]`)?.textContent?.trim()
      : '';
    const sourceTitle = (sourceEntry?.annotations?.title || sourceEntry?.summary || domSourceTitle || fallbackTitle || '').trim();
    const summaryTitles = Object.values(map).map(entry => (entry?.annotations?.title || entry?.summary || '').trim());
    const domTitles = typeof document !== 'undefined'
      ? [...(document.querySelectorAll?.('a[href^="/c/"]') || [])].map(el => el.textContent?.trim())
      : [];
    const title = nextBranchTitle(sourceTitle, [...summaryTitles, ...domTitles]);
    const annotations = typeof YF === 'object' && YF?.ConversationAnnotationsSchema && typeof Wb === 'function'
      ? Wb(YF.ConversationAnnotationsSchema, { title })
      : { title };
    const apply = () => svc.updateConversationAnnotations([newId], annotations, true);
    try { await apply(); } catch {}
    if (typeof setTimeout === 'function') setTimeout(() => { void Promise.resolve(apply()).catch(() => {}); }, 450);
    return title;
  }
  function isSubagentForkError(error) {
    return /invoked subagents/i.test(String(error?.message || error || ''));
  }
  async function forkViaSideQuestion(conversationId, targetStepIndex = -1) {
    const svc = service();
    if (typeof svc.startCascade !== 'function' || typeof svc.forkConversation !== 'function') {
      throw new Error('Side question fork promotion is unavailable');
    }
    const sqId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
    const baseTrajectoryIdentifier = typeof I === 'object' && I?.BaseTrajectoryIdentifierSchema && typeof Wb === 'function'
      ? Wb(I.BaseTrajectoryIdentifierSchema, { identifier: { case: 'cascadeId', value: conversationId } })
      : { identifier: { case: 'cascadeId', value: conversationId } };
    let started = false;
    try {
      await svc.startCascade({
        cascadeId: sqId,
        trajectoryType: 22,
        source: 1,
        baseTrajectoryIdentifier
      });
      started = true;
      return await svc.forkConversation({
        sourceCascadeId: sqId,
        forkAtStepIndex: targetStepIndex,
        targetForkWorkspace: 1
      });
    } finally {
      if (started && typeof svc.deleteCascadeTrajectory === 'function') {
        try { await svc.deleteCascadeTrajectory(sqId); } catch {}
      }
    }
  }
  async function fork(conversationId, stepIndex = -1, { exact = false, autoRename = true, allowSideQuestionFallback = true } = {}) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(conversationId || '') || !Number.isInteger(stepIndex) || stepIndex < -1) throw new Error('Invalid fork point');
    if (!exact) stepIndex = await forkPoint(conversationId, stepIndex);
    const svc = service();
    let response, promotedViaSideQuestion = false;
    try {
      response = await svc.forkConversation({ sourceCascadeId: conversationId, forkAtStepIndex: stepIndex, targetForkWorkspace: 1 });
    } catch (error) {
      if (!allowSideQuestionFallback || !isSubagentForkError(error) || typeof svc.startCascade !== 'function') throw error;
      response = await forkViaSideQuestion(conversationId, stepIndex);
      promotedViaSideQuestion = true;
    }
    if (!response?.newCascadeId) throw new Error('Antigravity returned no forked conversation');
    if (autoRename) await renameForkedConversation(conversationId, response.newCascadeId);
    return { conversationId: response.newCascadeId, projectId: response.newProjectId || '', forkedAtStepIndex: response.forkedAtStepIndex, warnings: response.warnings || [], promotedViaSideQuestion };
  }
  async function hydrateMedia(media,stepHandler){
    return (await Promise.all((media||[]).map(async item=>{
      if(item?.uri&&!(item.payload?.case==='inlineData'&&item.payload.value?.length>0)){
        const url=stepHandler?.resolveArtifactUrl?.(item.uri);
        if(url&&typeof fetch==='function'){
          try{const res=await fetch(url);if(res.ok){const bytes=new Uint8Array(await res.arrayBuffer());return{...item,uri:'',payload:{case:'inlineData',value:bytes}};}}catch{}
        }
      }
      return item;
    }))).filter(Boolean);
  }
  const suspendedEdits=new Map();
  function snapshotEditorState(editor){
    const state=editor?.getEditorState?.();
    let json=null;
    try{const raw=state?.toJSON?.();if(raw&&typeof raw==='object')json=JSON.stringify(raw);}catch{}
    return{state,json};
  }
  function applyEditorSnapshot(editor,snapshot){
    if(!editor?.setEditorState||!snapshot)return;
    try{
      if(snapshot.json&&typeof IJ==='function'){editor.setEditorState(IJ(editor,snapshot.json));return;}
    }catch{}
    try{if(snapshot.state)editor.setEditorState(snapshot.state);}catch{}
  }
  function restoreComposerHome(record){
    if(!record)return;
    try{
      if(record.inputBox&&record.homeParent&&record.homeParent.isConnected!==false){
        const refNode=record.homeNext?.parentNode===record.homeParent?record.homeNext:null;
        if(record.inputBox.parentNode!==record.homeParent||record.inputBox.nextSibling!==refNode){
          record.homeParent.insertBefore(record.inputBox,refNode);
        }
      }
      record.inlineHost?.remove?.();
      record.element?.removeAttribute?.('data-agy-editing-target');
    }catch{}
  }
  // The client's own "Send message" setting (Enter or Cmd/Ctrl+Enter), read from its app storage.
  let sendShortcut='enter';
  function refreshSendShortcut(){
    try{void Promise.resolve(globalThis.nativeStorage?.getItems?.()).then(items=>{sendShortcut=items?.sendMessageShortcut==='modEnter'?'modEnter':'enter';}).catch(()=>{});}catch{}
  }
  function isSendKey(event){
    if(event.key!=='Enter'||event.shiftKey||event.altKey||event.isComposing||event.keyCode===229)return false;
    const mod=Boolean(event.metaKey||event.ctrlKey);
    return sendShortcut==='modEnter'?mod:!mod;
  }
  function inlineEditText(edit){
    try{
      const collect=node=>{
        if(!node||typeof node!=='object')return '';
        const inlineNum=globalThis.__agyInlineImages?.parseMentionNodeInlineNumber?.(node);
        if(inlineNum)return `[Image #${inlineNum}]`;
        if(typeof node.text==='string')return node.text;
        return Array.isArray(node.children)?node.children.map(collect).join(node.type==='root'?'\n':''):'';
      };
      const text=collect(edit.editor?.getEditorState?.()?.toJSON?.()?.root).trim();
      if(text)return text;
    }catch{}
    const ce=edit.inlineHost?.querySelector?.('[contenteditable="true"]');
    return String(ce?.innerText??ce?.textContent??'').trim();
  }
  // A conversation restored before our hook loaded keeps the original send closure, so the edit
  // never reaches wrappedSend and lands at the bottom. Revert and resend here instead.
  async function submitPendingEditDirectly(edit){
    if(!edit||pendingEdit!==edit||typeof edit.sendMessage!=='function')return false;
    const text=inlineEditText(edit);
    const rawMedia=[...(edit.box?.getMediaAttachments?.()||[])];
    if(!text&&!rawMedia.length)return false;
    const items=replaceText(edit.messageItems||[],text);
    const prepared=runtimeEnabled&&inlineImagesEnabled
      ?globalThis.__agyInlineImages?.prepareOutgoingPayload?.({cascadeId:edit.cascadeId,items,media:rawMedia})
      :null;
    const media=prepared?.payload?.media||rawMedia;
    pendingEdit=null;suspendedEdits.delete(edit.cascadeId);restoreComposerHome(edit);
    applyEditorSnapshot(edit.editor,edit.savedSnapshot);
    try{edit.box?.setMediaAttachments?.(edit.savedMedia||[]);}catch{}
    installRequestOverrides();notifyEdit();
    const optimisticRevert=edit.optimistic?.applyOptimisticRevert?.(edit.cascadeId,edit.stepIndex-1);
    let reverted=false;
    try{
      await (sendService||service()).cancelCascadeInvocation?.({cascadeId:edit.cascadeId}).catch(()=>{});
      await edit.stepHandler.revertToIndex(edit.cascadeId,edit.stepIndex-1,{conversationOnly:true});
      reverted=true;
      await edit.sendMessage({type:1,cascadeId:edit.cascadeId,items,media,resend:'edit',commentOverrides:edit.comments});
      globalThis.__agyInlineImages?.onMessageSent?.(edit.cascadeId);
      return true;
    }catch(error){
      // Put the edited text back so nothing the user typed is lost.
      if(reverted&&typeof IJ==='function'&&typeof LN==='function'){try{edit.editor.setEditorState(IJ(edit.editor,LN(items)));edit.box?.setMediaAttachments?.(media);}catch{}}
      throw error;
    }finally{optimisticRevert?.dispose?.();}
  }
  function mountInlineEdit({element,cascadeId,stepIndex,messageItems,chatCtx,optCtx,box,editor,inputBox,homeParent,homeNext,savedSnapshot,savedMedia,comments,label,cancelLabel}){
    refreshSendShortcut();
    let inlineHost=null;
    if(inputBox&&homeParent&&typeof document.createElement==='function'){
      inlineHost=document.createElement('div');
      inlineHost.dataset.agyEditorSlot='';
      inlineHost.dataset.testid='agy-inline-edit-host';
      inlineHost.className='w-full flex flex-col gap-1.5';
      const header=document.createElement('div');
      header.dataset.testid='agy-edit-banner';
      header.className='flex items-center justify-between gap-2 px-1 text-sm text-muted-foreground select-none';
      const title=document.createElement('span');
      title.className='truncate';
      title.textContent=label;
      const cancelButton=document.createElement('button');
      cancelButton.type='button';
      cancelButton.dataset.testid='agy-edit-cancel';
      cancelButton.className='shrink-0 px-2 py-0.5 rounded-md border border-border bg-card text-foreground hover:bg-secondary transition-colors cursor-pointer';
      cancelButton.textContent=cancelLabel;
      cancelButton.addEventListener('click',event=>{event.stopPropagation();cancelEdit();});
      header.append(title,cancelButton);
      inlineHost.append(header);
      inlineHost.addEventListener('keydown',event=>{
        if(event.key==='Escape'&&!event.defaultPrevented&&!document.querySelector?.('[role="listbox"],[role="menu"],[data-select-popup],[data-testid="agy-context-popup"],[data-testid="agy-stats-popup"]')){
          event.preventDefault();event.stopPropagation();cancelEdit();
        }
      });
      const takeOver=event=>{event.preventDefault();event.stopImmediatePropagation?.();event.stopPropagation();void submitPendingEditDirectly(pendingEdit).catch(()=>{});};
      const ownsEdit=()=>pendingEdit?.inlineHost===inlineHost&&typeof pendingEdit.sendMessage==='function';
      inlineHost.addEventListener('keydown',event=>{
        if(ownsEdit()&&isSendKey(event)&&event.target?.closest?.('[contenteditable="true"]')&&!document.querySelector?.('[role="listbox"],[role="menu"],[data-select-popup]'))takeOver(event);
      },true);
      inlineHost.addEventListener('click',event=>{
        const send=event.target?.closest?.('[data-testid="send-button"]');
        if(ownsEdit()&&send&&!send.disabled)takeOver(event);
      },true);
      element.setAttribute?.('data-agy-editing-target','');
      if(element.prepend)element.prepend(inlineHost);else element.insertBefore?.(inlineHost,element.firstChild||null);
      inlineHost.append(inputBox);
    }
    pendingEdit={cascadeId,stepIndex,messageItems:Array.isArray(messageItems)?messageItems:[],element,box,editor,inputBox,homeParent,homeNext,inlineHost,stepHandler:chatCtx.stepHandler,sendMessage:typeof chatCtx.sendMessage==='function'?chatCtx.sendMessage.bind(chatCtx):null,optimistic:optCtx,savedEditorState:savedSnapshot?.state,savedSnapshot,savedMedia,comments,label,cancelLabel};
    installRequestOverrides(element);notifyEdit();
    editor.focus?.();(inlineHost||box.getInputCardElement?.())?.scrollIntoView?.({behavior:'smooth',block:'nearest'});
    return pendingEdit;
  }
  function suspendEdit(){
    if(!pendingEdit)return null;
    const current=pendingEdit;pendingEdit=null;
    const editSnapshot=snapshotEditorState(current.editor);
    const editMedia=[...(current.box?.getMediaAttachments?.()||[])];
    const record={
      cascadeId:current.cascadeId,
      stepIndex:current.stepIndex,
      editSnapshot,
      editMedia,
      savedSnapshot:current.savedSnapshot,
      savedMedia:current.savedMedia,
      comments:current.comments,
      label:current.label,
      cancelLabel:current.cancelLabel
    };
    suspendedEdits.set(current.cascadeId,record);
    restoreComposerHome(current);
    applyEditorSnapshot(current.editor,current.savedSnapshot);
    try{current.box?.setMediaAttachments?.(current.savedMedia||[]);}catch{}
    installRequestOverrides();notifyEdit();
    return record;
  }
  function getSuspendedEdit(cascadeId){return cascadeId?suspendedEdits.get(cascadeId)||null:null;}
  function clearSuspendedEdits(cascadeId){if(cascadeId)suspendedEdits.delete(cascadeId);else suspendedEdits.clear();}
  function cancelEdit({restoreDraft=true}={}){
    if(!pendingEdit)return false;
    const current=pendingEdit;pendingEdit=null;suspendedEdits.delete(current.cascadeId);restoreComposerHome(current);installRequestOverrides();
    if(restoreDraft){
      applyEditorSnapshot(current.editor,current.savedSnapshot);
      try{current.box?.setMediaAttachments?.(current.savedMedia||[]);}catch{}
    }
    notifyEdit();return true;
  }
  async function beginEdit(element,{label='正在编辑此条消息（发送后将从此处重新生成）',cancelLabel='取消'}={}){
    const message=userMessage(element);
    const list=providers(element);
    const chatCtx=list.find(p=>p.value?.stepHandler?.revertToIndex)?.value;
    const ibCtx=list.find(p=>p.value?.inputBoxRef&&typeof p.value?.getLexicalEditor==='function')?.value;
    const optCtx=list.find(p=>typeof p.value?.applyOptimisticRevert==='function')?.value;
    const box=ibCtx?.inputBoxRef?.current||chatCtx?.inputBoxRef?.current;
    const editor=box?.lexicalRef?.current||ibCtx?.getLexicalEditor?.();
    if(!message||!chatCtx?.stepHandler?.revertToIndex||!box||!editor||typeof IJ!=='function'||typeof LN!=='function')throw new Error('当前消息不支持编辑');
    const stepIndex=HU(message.metadata);
    const view=element.closest?.('[data-testid="conversation-view"]');
    const inputBox=view?.querySelector?.('[data-testid="agent-input-box"]')||box.getInputCardElement?.()?.closest?.('[data-testid="agent-input-box"]')||null;
    const sameConvo=pendingEdit?.cascadeId===message.cascadeId;
    const priorSuspended=!sameConvo?suspendedEdits.get(message.cascadeId):null;
    suspendedEdits.delete(message.cascadeId);
    const savedSnapshot=sameConvo?pendingEdit.savedSnapshot:priorSuspended?priorSuspended.savedSnapshot:snapshotEditorState(editor);
    const savedMedia=sameConvo?pendingEdit.savedMedia:priorSuspended?priorSuspended.savedMedia:[...(box.getMediaAttachments?.()||[])];
    const homeParent=sameConvo&&pendingEdit.homeParent?pendingEdit.homeParent:inputBox?.parentElement||null;
    const homeNext=sameConvo&&pendingEdit.homeParent?pendingEdit.homeNext:inputBox?.nextSibling||null;
    if(pendingEdit){
      if(pendingEdit.cascadeId!==message.cascadeId)suspendEdit();
      else{pendingEdit.inlineHost?.remove?.();pendingEdit.element?.removeAttribute?.('data-agy-editing-target');}
    }
    editor.setEditorState(IJ(editor,LN(message.step.items||[])));
    const media=await hydrateMedia(message.step.media,chatCtx.stepHandler);
    box.setMediaAttachments?.(media);
    chatCtx.restoreReviewComments?.({cascadeId:message.cascadeId,comments:message.step});
    return mountInlineEdit({
      element,cascadeId:message.cascadeId,stepIndex,messageItems:message.step.items||[],chatCtx,optCtx,box,editor,inputBox,homeParent,homeNext,savedSnapshot,savedMedia,
      comments:{artifactComments:message.step.artifactComments||[],fileDiffComments:message.step.fileDiffComments||[],fileComments:message.step.fileComments||[]},
      label,cancelLabel
    });
  }
  function resumeEdit(element){
    if(pendingEdit||!element)return null;
    const message=userMessage(element);
    if(!message)return null;
    const suspended=suspendedEdits.get(message.cascadeId);
    if(!suspended||HU(message.metadata)!==suspended.stepIndex)return null;
    const list=providers(element);
    const chatCtx=list.find(p=>p.value?.stepHandler?.revertToIndex)?.value;
    const ibCtx=list.find(p=>p.value?.inputBoxRef&&typeof p.value?.getLexicalEditor==='function')?.value;
    const optCtx=list.find(p=>typeof p.value?.applyOptimisticRevert==='function')?.value;
    const box=ibCtx?.inputBoxRef?.current||chatCtx?.inputBoxRef?.current;
    const editor=box?.lexicalRef?.current||ibCtx?.getLexicalEditor?.();
    const view=element.closest?.('[data-testid="conversation-view"]');
    const inputBox=view?.querySelector?.('[data-testid="agent-input-box"]')||box?.getInputCardElement?.()?.closest?.('[data-testid="agent-input-box"]')||null;
    const homeParent=inputBox?.parentElement||null;
    const homeNext=inputBox?.nextSibling||null;
    if(!chatCtx?.stepHandler?.revertToIndex||!box||!editor||!inputBox||!homeParent)return null;
    suspendedEdits.delete(message.cascadeId);
    applyEditorSnapshot(editor,suspended.editSnapshot);
    try{box.setMediaAttachments?.(suspended.editMedia||[]);}catch{}
    return mountInlineEdit({
      element,cascadeId:suspended.cascadeId,stepIndex:suspended.stepIndex,messageItems:message.step.items||[],chatCtx,optCtx,box,editor,inputBox,homeParent,homeNext,
      savedSnapshot:suspended.savedSnapshot,savedMedia:suspended.savedMedia,comments:suspended.comments,
      label:suspended.label,cancelLabel:suspended.cancelLabel
    });
  }
  const validCascadeId = id => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id);
  async function unarchiveConversations(ids) {
    const list = [...new Set((Array.isArray(ids) ? ids : [ids]).map(v => String(v || '').trim()).filter(validCascadeId))];
    if (!list.length) return { ok: true, count: 0, ids: [] };
    const svc = service();
    if (typeof svc.updateConversationAnnotations !== 'function') throw new Error('当前客户端不支持取消归档');
    const st = store();
    const requestId = `agy-unarchive-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    st?.dispatch?.({ type: 'trajectorySummaries/applyOptimisticAnnotationBatch', payload: { cascadeIds: list, annotations: { archived: false }, requestId } });
    const annotations = typeof YF === 'object' && YF?.ConversationAnnotationsSchema && typeof Wb === 'function'
      ? Wb(YF.ConversationAnnotationsSchema, { archived: false })
      : { archived: false };
    try {
      await svc.updateConversationAnnotations(list, annotations, true);
      st?.dispatch?.({ type: 'trajectorySummaries/settleOptimisticAnnotationBatch', payload: { cascadeIds: list, requestId } });
      if (typeof setTimeout === 'function') {
        setTimeout(() => { st?.dispatch?.({ type: 'trajectorySummaries/dropOptimisticAnnotationBatch', payload: { cascadeIds: list, requestId } }); }, 3000);
      }
      return { ok: true, count: list.length, ids: list };
    } catch (error) {
      st?.dispatch?.({ type: 'trajectorySummaries/dropOptimisticAnnotationBatch', payload: { cascadeIds: list, requestId } });
      throw error;
    }
  }
  async function deleteConversations(ids, { onProgress } = {}) {
    const list = [...new Set((Array.isArray(ids) ? ids : [ids]).map(v => String(v || '').trim()).filter(validCascadeId))];
    if (!list.length) return { ok: true, deletedCount: 0, deletedIds: [], failed: [] };
    const svc = service();
    if (typeof svc.deleteCascadeTrajectory !== 'function' && typeof svc.deleteSummary !== 'function') {
      throw new Error('当前客户端不支持删除会话');
    }
    const st = store();
    const deletedIds = [];
    const failed = [];
    const isNotFound = err => err?.code === 5 || /not[\s_-]*found/i.test(String(err?.message || err || ''));
    const snap = btwSubtreeEnabled ? btwTreeSnapshot() : { parentByChild: {} };
    for (let i = 0; i < list.length; i++) {
      const id = list[i];
      const parentId = snap.parentByChild?.[id] || '';
      const prevSummary = st?.getState?.()?.trajectorySummaries?.summaries?.[id];
      st?.dispatch?.({ type: 'trajectorySummaries/applyOptimisticDelete', payload: { cascadeId: id } });
      if (parentId) {
        const rmReq = `agy-rm-sq-${Date.now()}-${i}`;
        st?.dispatch?.({ type: 'trajectorySummaries/applyOptimisticAnnotationBatch', payload: { cascadeIds: [parentId], annotations: { removeSideQuestionCascadeId: id }, requestId: rmReq } });
        st?.dispatch?.({ type: 'trajectorySummaries/settleOptimisticAnnotationBatch', payload: { cascadeIds: [parentId], requestId: rmReq } });
      }
      try {
        if (typeof svc.deleteCascadeTrajectory === 'function') {
          try {
            await svc.deleteCascadeTrajectory(id);
          } catch (err) {
            if (isNotFound(err) && typeof svc.deleteSummary === 'function') {
              await svc.deleteSummary({ cascadeId: id }).catch(() => {});
            } else if (!isNotFound(err)) {
              throw err;
            }
          }
        } else {
          await svc.deleteSummary({ cascadeId: id });
        }
        deletedIds.push(id);
      } catch (error) {
        if (prevSummary) st?.dispatch?.({ type: 'trajectorySummaries/rollbackDelete', payload: { cascadeId: id, summary: prevSummary } });
        failed.push({ id, message: String(error?.message || error || '') });
      }
      try { onProgress?.({ completed: i + 1, total: list.length, id }); } catch {}
    }
    if (!deletedIds.length && failed.length) throw new Error(failed[0].message || '删除会话失败');
    return { ok: failed.length === 0, deletedCount: deletedIds.length, deletedIds, failed };
  }
  const customSidePanelEntries = new Map();
  function featureRegistry() {
    return providers(pageSource()).find(p => p.value?.getCache instanceof Map && typeof p.value?.get === 'function')?.value || null;
  }
  function refreshAuxSidePanel() {
    try {
      const target = typeof document !== 'undefined'
        ? (document.querySelector('[data-testid="side-panel-new-tab-view"]') || document.querySelector('[data-side-panel-strip]'))
        : null;
      for (let node = fiber(target); node; node = node.return) {
        if (typeof node.type !== 'function') continue;
        for (let h = node.memoizedState; h && typeof h === 'object'; h = h.next) {
          if (typeof h.memoizedState === 'number' && typeof h.queue?.dispatch === 'function') {
            const cur = h.memoizedState;
            h.queue.dispatch(cur + 1);
            setTimeout(() => { try { h.queue.dispatch(cur); } catch {} }, 0);
            return;
          }
        }
      }
    } catch { /* Best effort refresh. */ }
  }
  function setCustomSidePanel(key, descriptor, skipIfPresent = false) {
    if (!key) return false;
    const feat = featureRegistry();
    if (!feat) {
      if (!descriptor) customSidePanelEntries.delete(key);
      return false;
    }
    const current = feat.get('customSidePanels');
    if (!(current instanceof Map)) return false;
    if (descriptor && skipIfPresent && current.has(key)) return true;
    const entries = [...current.entries()].filter(([k]) => k !== key);
    if (descriptor) {
      entries.push([key, descriptor]);
      customSidePanelEntries.set(key, descriptor);
    } else {
      if (!current.has(key) && !customSidePanelEntries.has(key)) return true;
      customSidePanelEntries.delete(key);
    }
    feat.getCache.set('customSidePanels', new Map(entries));
    refreshAuxSidePanel();
    return true;
  }
  function clearCustomSidePanels() {
    if (!customSidePanelEntries.size) return;
    const feat = featureRegistry();
    const current = feat?.get?.('customSidePanels');
    if (feat && current instanceof Map) {
      const entries = [...current.entries()].filter(([k]) => !customSidePanelEntries.has(k));
      feat.getCache.set('customSidePanels', new Map(entries));
      refreshAuxSidePanel();
    }
    customSidePanelEntries.clear();
  }
  function openMaxSidecarPane() {
    if (typeof document === 'undefined') return false;
    const slotSel = '[data-testid="sidecar-iframe-slot"][data-sidecar-id="agy-max/inspector"],[data-testid="sidecar-iframe-slot"][data-sidecar-id="inspector"],[data-agy-max-aux-host]';
    const auxOpen = Boolean(document.querySelector('[data-side-panel-open="true"],[data-aux-pane-open="true"],[data-testid="toggle-aux-sidebar"][aria-expanded="true"]'));
    if (!auxOpen) toggleAuxPane();
    if (document.querySelector(`${slotSel}[data-visible="true"]`)) return true;
    const item = document.querySelector('[data-testid="plugins-submenu-item"][data-sidecar-id="agy-max/inspector"],[data-testid="plugins-submenu-item"][data-sidecar-id="inspector"]');
    if (item) { item.click?.(); return true; }
    const cid = activeRouteCascadeId();
    const st = store();
    const feat = featureRegistry();
    const ext = feat?.get?.('extensibility');
    const rawViews = ext?.provider?.getState?.()?.views || ext?.getViews?.() || [];
    const view = Array.isArray(rawViews) ? rawViews.find(v => v?.sidecarId === 'agy-max/inspector' || v?.sidecarId === 'inspector') : null;
    if (cid && st?.dispatch && view?.url) {
      const panelScope = { kind: 'cascadeId', cascadeId: cid };
      const content = { type: 'sidecarView', sidecarView: { sidecarId: view.sidecarId, path: view.path || '/', url: view.url, title: view.title || 'Antigravity Max' } };
      const tabId = `sidecar__${view.sidecarId}__${view.path || '/'}`;
      const slice = feat?.get?.('auxPaneComponent')?.redesignEnabled === true && st.getState?.()?.auxPane ? 'auxPane' : 'sidePanel';
      try {
        st.dispatch({ type: `${slice}/setContent`, payload: { panelScope, content, tabId, keepOpen: true } });
        st.dispatch({ type: `${slice}/setOpen`, payload: { panelScope, isOpen: true } });
        return true;
      } catch {}
    }
    return false;
  }
  function recentWorkspaces() {
    const s=store()?.getState?.();
    const summaries=s?.trajectorySummaries?.summaries;
    if(!summaries||typeof summaries!=='object')return [];
    const byUri=new Map();
    for(const summary of Object.values(summaries)){
      if(!summary)continue;
      const uri=extractWorkspaceUriFromSummary(summary);
      if(!uri)continue;
      const meta=summary.trajectoryMetadata||{};
      const modifiedSec=Number(summary.lastModifiedTime?.seconds||meta.createdAt?.seconds||summary.createdTime?.seconds||0);
      const updatedAtMs=modifiedSec>0?modifiedSec*1000:0;
      const key=uri.replace(/^file:\/\/\/[A-Z]:/i,drive=>drive.toLowerCase());
      const prev=byUri.get(key);
      if(!prev||updatedAtMs>prev.updatedAtMs){
        byUri.set(key,{uri,name:workspaceNameFromUri(uri)||uri,updatedAtMs});
      }
    }
    return [...byUri.values()].sort((a,b)=>(b.updatedAtMs-a.updatedAtMs)||a.name.localeCompare(b.name)).slice(0,20);
  }
  function sidebarProjects() {
    const list=store()?.getState?.()?.sidebarProjects?.projects;
    return Array.isArray(list)?list:[];
  }
  function isSidecarInternalProject(id,name,folderUri,projObj=null,sidecarIds=null) {
    if(projObj?.sidecar)return true;
    const uri=String(folderUri||'').toLowerCase();
    if(uri.includes('/sidecar_data/')||uri.includes('\\sidecar_data\\'))return true;
    const cleanName=String(name||'').trim();
    if(sidecarIds&&sidecarIds.has(id))return true;
    if(cleanName&&/^[a-z0-9_.-]+\/(?:inspector|swarm_board)$/i.test(cleanName))return true;
    return false;
  }
  function movableProjects(includeProjectId='') {
    const sidecarIds=new Set();
    try{
      const ext=featureRegistry()?.get?.('extensibility');
      const rawSidecars=ext?.provider?.getState?.()?.sidecars||ext?.getSidecars?.()||[];
      for(const sc of Array.isArray(rawSidecars)?rawSidecars:[]){
        const pid=sc?.userConfig?.projectId||sc?.projectId;
        if(typeof pid==='string'&&pid)sidecarIds.add(pid);
      }
    }catch{}
    const byId=new Map();
    for(const item of sidebarProjects()){
      const id=String(item?.id||'').trim();
      if(!id||id==='outside-of-project'||id==='standalone')continue;
      const folderUri=Array.isArray(item?.folderUris)?item.folderUris[0]||'':(item?.folderUri||'');
      const name=String(item?.name||item?.label||workspaceNameFromUri(folderUri)||id).trim();
      if(id!==includeProjectId&&isSidecarInternalProject(id,name,folderUri,item,sidecarIds))continue;
      const kind=String(folderUri).includes('/ssh-projects/')?'ssh':'folder';
      byId.set(id,{id,name,archived:false,folderUri,kind});
    }
    const pms=providers(pageSource()).find(p=>p.value?.core?.projectManagementService)?.value?.core?.projectManagementService;
    const pStates=pms?.projectsStateProvider?.getState?.();
    if(Array.isArray(pStates)){
      for(const entry of pStates){
        const proj=entry?.project||entry;
        const id=String(proj?.id||'').trim();
        if(!id||id==='outside-of-project'||id==='standalone'||entry?.isPlaceholder||proj?.coordinator)continue;
        const prev=byId.get(id);
        const name=String(proj?.name||prev?.name||id).trim();
        const folderUri=prev?.folderUri||'';
        if(id!==includeProjectId&&isSidecarInternalProject(id,name,folderUri,proj,sidecarIds)){
          byId.delete(id);
          continue;
        }
        const archived=Boolean(proj?.archived);
        if(archived&&id!==includeProjectId){
          byId.delete(id);
          continue;
        }
        const kind=proj?.backendType===2||proj?.backendType===3?'cloud':(prev?.kind||'folder');
        byId.set(id,{id,name,archived,folderUri,kind});
      }
    }
    return [...byId.values()];
  }
  function conversationProjectId(cascadeId='') {
    if(!cascadeId)return 'outside-of-project';
    const summary=store()?.getState?.()?.trajectorySummaries?.summaries?.[cascadeId];
    return normalizeProjectTarget(summary?.trajectoryMetadata?.projectId||summary?.projectId||'');
  }
  function isMovableConversation(cascadeId='') {
    if(!validCascadeId(cascadeId))return false;
    const summary=store()?.getState?.()?.trajectorySummaries?.summaries?.[cascadeId];
    if(!summary||summary.annotations?.archived||summary.annotations?.coordinator)return false;
    const meta=summary.trajectoryMetadata||{};
    if(meta.parentConversationId||summary.parentConversationId||Number(meta.nestingDepth||summary.nestingDepth||0)>0||meta.isBattleModeFork)return false;
    if(summary.trajectoryType===22&&!btwDetachedSet.has(cascadeId))return false;
    if(btwSubtreeEnabled&&btwTreeSnapshot().parentByChild[cascadeId])return false;
    return true;
  }
  function applySingleProjectMove(cascadeId,targetProjectId,{silentRefresh=false}={}) {
    if(syncingProjectMoves||!validCascadeId(cascadeId))return false;
    const st=store();
    const summary=st?.getState?.()?.trajectorySummaries?.summaries?.[cascadeId];
    if(!st?.dispatch||!summary)return false;
    const normalized=normalizeProjectTarget(targetProjectId);
    const cur=normalizeProjectTarget(summary.trajectoryMetadata?.projectId||summary.projectId||'');
    const prevReq=activeProjectMoveRequests.get(cascadeId);
    if(cur===normalized&&prevReq?.projectId===normalized)return false;
    const requestId=`agy-proj-move-${cascadeId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`;
    // Record BEFORE st.dispatch because Redux notifies subscribers synchronously inside dispatch()!
    activeProjectMoveRequests.set(cascadeId,{requestId,projectId:normalized});
    syncingProjectMoves=true;
    try{
      if(prevReq?.requestId){
        try{st.dispatch({type:'trajectorySummaries/dropOptimisticAnnotationBatch',payload:{cascadeIds:[cascadeId],requestId:prevReq.requestId}});}catch{}
      }
      st.dispatch({type:'trajectorySummaries/applyOptimisticAnnotationBatch',payload:{cascadeIds:[cascadeId],annotations:{projectId:normalized},requestId}});
      st.dispatch({type:'trajectorySummaries/settleOptimisticAnnotationBatch',payload:{cascadeIds:[cascadeId],requestId}});
    }catch{
      if(prevReq)activeProjectMoveRequests.set(cascadeId,prevReq);
      else activeProjectMoveRequests.delete(cascadeId);
      return false;
    }finally{
      syncingProjectMoves=false;
    }
    const childIds=btwSubtreeEnabled?btwTreeSnapshot().childrenByParent[cascadeId]:null;
    if(Array.isArray(childIds)&&childIds.length){
      for(const sqId of childIds)syncedBtwSummarySig.delete(sqId);
      hydrateBtwSummaries();
    }
    if(!silentRefresh)refreshSidebarList();
    return true;
  }
  function applyProjectOverrides(overrides) {
    if(!overrides||typeof overrides!=='object')return 0;
    let changed=0;
    for(const [cid,pid] of Object.entries(overrides)){
      if(applySingleProjectMove(cid,pid,{silentRefresh:true}))changed++;
    }
    if(changed>0)refreshSidebarList();
    return changed;
  }
  async function detachBtwConversation(sqId,parentId='') {
    if(!validCascadeId(sqId))throw new Error('无效的侧边对话 ID');
    const st=store();
    const summaries=st?.getState?.()?.trajectorySummaries?.summaries||{};
    const snap=btwTreeSnapshot();
    const ownerId=parentId||snap.parentByChild[sqId]||'';
    const title=String(summaries[sqId]?.annotations?.title||snap.titlesByChild[sqId]||summaries[sqId]?.summary||'').trim();
    let newConversationId='';
    try{
      const svc=service();
      if(typeof svc?.forkConversation==='function'){
        const forked=await svc.forkConversation({sourceCascadeId:sqId,forkAtStepIndex:-1,targetForkWorkspace:1});
        if(forked?.newCascadeId){
          newConversationId=forked.newCascadeId;
          if(title&&typeof svc.updateConversationAnnotations==='function'){
            const ann=typeof YF==='object'&&YF?.ConversationAnnotationsSchema&&typeof Wb==='function'
              ?Wb(YF.ConversationAnnotationsSchema,{title})
              :{title};
            await svc.updateConversationAnnotations([newConversationId],ann,true).catch(()=>{});
          }
          if(typeof svc.deleteCascadeTrajectory==='function'){
            await svc.deleteCascadeTrajectory(sqId).catch(()=>{});
          }
        }
      }
    }catch{}
    if(ownerId&&st?.dispatch){
      const rmReq=`agy-detach-sq-${Date.now().toString(36)}`;
      st.dispatch({type:'trajectorySummaries/applyOptimisticAnnotationBatch',payload:{cascadeIds:[ownerId],annotations:{removeSideQuestionCascadeId:sqId},requestId:rmReq}});
      st.dispatch({type:'trajectorySummaries/settleOptimisticAnnotationBatch',payload:{cascadeIds:[ownerId],requestId:rmReq}});
      try{
        const svc=service();
        const curIds=summaries[ownerId]?.annotations?.sideQuestionCascadeIds;
        if(Array.isArray(curIds)&&typeof svc?.updateConversationAnnotations==='function'){
          const remaining=curIds.filter(x=>x!==sqId);
          const ann=typeof YF==='object'&&YF?.ConversationAnnotationsSchema&&typeof Wb==='function'
            ?Wb(YF.ConversationAnnotationsSchema,{sideQuestionCascadeIds:remaining})
            :{sideQuestionCascadeIds:remaining};
          await svc.updateConversationAnnotations([ownerId],ann,true).catch(()=>{});
        }
      }catch{}
    }
    btwDetachedSet.add(sqId);
    refreshSidebarList();
    return {ok:true,newConversationId:newConversationId||sqId};
  }
  function projectIdFromElement(element) {
    for(let node=fiber(element);node;node=node.return){
      if(typeof node.memoizedProps?.projectId==='string'&&node.memoizedProps.projectId)return node.memoizedProps.projectId;
    }
    return '';
  }
  async function createNativeProject({id,name,folderUri}={}) {
    const core=providers(pageSource()).find(p=>p.value?.core?.projectManagementService)?.value?.core;
    const pms=core?.projectManagementService;
    if(!pms||typeof pms.createProject!=='function')throw new Error('当前 Antigravity 客户端暂不支持原生项目创建接口');
    const nb=globalThis.__agyNativeBindings||{};
    const resSchema=nb.projectResourceSchema;
    const projSchema=nb.projectSchema;
    const factory=nb.createProjectFactory;
    const resProto=typeof Wb==='function'&&resSchema
      ?Wb(resSchema,{type:{case:'folderUri',value:folderUri}})
      :{type:{case:'folderUri',value:folderUri}};
    const projProto=typeof factory==='function'
      ?factory(name,id,[resProto],false)
      :(typeof Wb==='function'&&projSchema
        ?Wb(projSchema,{id,name,projectResources:{resources:[resProto]},isWorkspaceOnly:false})
        :{id,name,projectResources:{resources:[resProto]},isWorkspaceOnly:false});
    await pms.createProject(projProto);
    try{core.storageService?.store?.('lastCreatedProjectId',id);}catch{}
    try{
      const r=router();
      if(typeof r?.navigate==='function')await r.navigate({to:'/',search:{project:id}});
    }catch{}
    return {ok:true,projectId:id};
  }
  function activateConversationPane(cascadeId='') {
    if(!validCascadeId(cascadeId))return false;
    const st=store();
    if(!st?.dispatch)return false;
    try{
      const mcl=st.getState?.()?.multiConvoLayout;
      const root=mcl?.rootNode;
      let ids=[cascadeId];
      if(root&&root.type==='split'&&Array.isArray(root.children)){
        const leaves=[],walk=n=>{if(!n)return;if(n.type==='pane')leaves.push(n);else if(Array.isArray(n.children))n.children.forEach(walk);};
        walk(root);
        const focusId=mcl.focusedPaneId||leaves[0]?.id;
        if(leaves.length>1){
          const existing=leaves.find(p=>p.cascadeId===cascadeId);
          ids=existing?leaves.map(p=>p.cascadeId):leaves.map(p=>p.id===focusId?cascadeId:p.cascadeId);
        }
      }
      st.dispatch({type:'multiConvoLayout/setLayoutFromUrl',payload:{ids,focusedId:cascadeId,savedLayout:null}});
      st.dispatch({type:'conversation/setCascadeId',payload:{cascadeId}});
      return true;
    }catch{return false;}
  }
  globalThis.__agyNativeAdapter = { version,get active(){return !disposed;},get stageUpdates(){return runtimeEnabled&&stageUpdatesEnabled;},get pendingEdit(){return pendingEdit;},onEditChange,onGoalDetected,beginEdit,suspendEdit,resumeEdit,getSuspendedEdit,clearSuspendedEdits,cancelEdit,cancelInvocation,resumeGoalInvocation,ensureRequestHook,fiber, providers, service, authService, startAccountLogin,loginUrl,onLoginUrlChange,cancelAccountLogin, wrap, store, router, overview, canToggleAuxPane, toggleAuxPane, openMaxSidecarPane, capabilities, executionState, unreadCount, workspaceUri, recentWorkspaces, sidebarProjects, movableProjects, conversationProjectId, isMovableConversation, applySingleProjectMove, applyProjectOverrides, btwTreeSnapshot, hydrateBtwSummaries, setBtwSubtree, setBtwTreeState, detachBtwConversation, activateConversationPane, projectIdFromElement, createNativeProject, setCustomSidePanel, conversationDirectory, unarchiveConversations, deleteConversations, subagents, openSubagent, composerCascadeId, fileTreeEntry, findComposer, isNestedComposer, getComposerText, setComposerText, attachFileToComposer, setEnabled, setContextLimit, setStageUpdates, setEfficientIO, setPragmaticCoding, setGoalBar, setInlineImages, setInlineImagesLanguage, setConversationGoal, setSidebarProjectLimit, setSidebarProjectPin, useConversationProjectPin, installPage, fork, forkViaSideQuestion, forkPoint, nextBranchTitle, renameForkedConversation, userMessage, userMessageText,finalResponseText, navigateTurn, replaceText, editAndResend,
    dispose(){disposed=true;globalThis.__agyInlineImages?.dispose?.();if(typeof stopPinStorageWatch==='function')stopPinStorageWatch();else stopPinStorageWatch?.dispose?.();for(const [cid,entry] of activeProjectMoveRequests){try{store()?.dispatch?.({type:'trajectorySummaries/dropOptimisticAnnotationBatch',payload:{cascadeIds:[cid],requestId:entry.requestId}});}catch{}}activeProjectMoveRequests.clear();syncedBtwSummarySig.clear();btwDiskMeta={};clearCustomSidePanels();suspendedEdits.clear();conversationGoals.clear();goalDetectListeners.clear();cancelEdit({restoreDraft:false});editListeners.clear();if(sendService&&originalSend)sendService.sendUserCascadeMessage=originalSend;if(originalResolve)globalThis[hookNames.resolve]=originalResolve;if(originalSegmentRender&&globalThis[hookNames.segment]===stageSegmentRender)globalThis[hookNames.segment]=originalSegmentRender;let sidebarRestored=false;if(originalSidebarItems&&hookNames.sidebarItems&&globalThis[hookNames.sidebarItems]===wrappedSidebarItems){globalThis[hookNames.sidebarItems]=originalSidebarItems;sidebarRestored=true;}if(originalSidebarData&&hookNames.sidebarData&&globalThis[hookNames.sidebarData]===wrappedSidebarData){globalThis[hookNames.sidebarData]=originalSidebarData;sidebarRestored=true;}if(originalProjectHeader&&hookNames.projectHeader&&globalThis[hookNames.projectHeader]===wrappedProjectHeader){globalThis[hookNames.projectHeader]=originalProjectHeader;sidebarRestored=true;}if(sidebarRestored)refreshSidebarList();} };
})();
