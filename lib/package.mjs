import { readFileSync, readdirSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, relative, dirname, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

export const PACKAGE_ID='agy-max';
export const PACKAGE_ITEMS=['packages','vendor','ui','assets','rules','skills','sidecars','lib','scripts','docs','package.json','package-lock.json','plugin.json','hooks.json','mcp_config.json','project.json','README.md','README_EN.md','LICENSE','install.ps1','uninstall.ps1','install.sh','uninstall.sh'];
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
// v1.4.1 and older look for `.bundle.gz` and reject the packages/ and vendor/ top-level dirs, so a new name makes them fall back to the download page instead of a failed update.
// Rename this again whenever PACKAGE_ITEMS gains a top-level entry.
export const releaseName=version=>`${PACKAGE_ID}-v${version}.pkg.gz`;
const versionPattern=/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const required=['package.json','plugin.json','hooks.json','mcp_config.json','project.json','packages/core/catalog.mjs','packages/core/hook-bus.mjs','packages/core/module-registry.mjs','lib/native-host.mjs','lib/native-ui.js','lib/lifecycle.mjs','scripts/update-worker.mjs','scripts/ssh-mcp-server.mjs','scripts/ssh-boundary-hook.mjs','sidecars/inspector/main.mjs','sidecars/inspector/sidecar.json'];
const runtimeScripts=new Set(['install.mjs','uninstall.mjs','update-worker.mjs','telemetry-hook.mjs','ssh-boundary-hook.mjs','ssh-mcp-server.mjs','fork-session.mjs','build-release.mjs','build-seeds.mjs']);

export function safePackagePath(name){
  return typeof name==='string'&&name.length<240&&!name.includes('\\')&&!name.includes(':')&&
    name.split('/').every(part=>part&&part!=='.'&&part!=='..'&&!/[ .]$/.test(part)&&!/[\x00-\x1f<>"|?*]/.test(part)&&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))&&
    PACKAGE_ITEMS.includes(name.split('/')[0]);
}

export function sanitizePluginReadme(content, version) {
  const summary = `<p>v${version} | MIT License | Antigravity 2.35.1+ | Node.js &gt;= 22.13 | Windows / macOS / Linux</p>`;
  return content.replace(/<!--\s*plugin-badges:start\s*-->[\s\S]*?<!--\s*plugin-badges:end\s*-->/g, summary);
}

export function collectPackage(source){
  const pkg=JSON.parse(readFileSync(join(source,'package.json'),'utf8'));
  const files=[];
  function visit(path){
    const stat=lstatSync(path);if(stat.isSymbolicLink())throw Error('安装包不能包含符号链接');
    if(stat.isDirectory()){for(const name of readdirSync(path).sort())visit(join(path,name));return;}
    if(!stat.isFile())throw Error('安装包包含不支持的文件');
    const name=relative(source,path).replaceAll('\\','/');if(name.startsWith('scripts/')&&!runtimeScripts.has(name.slice(8)))return;if(name.startsWith('packages/')&&name.endsWith('.test.mjs'))return;if(/^docs\/upstream-research-/.test(name))return;if(!safePackagePath(name))throw Error('安装包路径无效');
    let bytes=readFileSync(path);
    if(name==='README.md'||name==='README_EN.md')bytes=Buffer.from(sanitizePluginReadme(bytes.toString('utf8'),pkg.version),'utf8');
    files.push({path:name,sha256:sha256(bytes),data:bytes.toString('base64')});
  }
  for(const item of PACKAGE_ITEMS){try{lstatSync(join(source,item));}catch(error){if(error.code==='ENOENT')continue;throw error;}visit(join(source,item));}
  return validatePackage({format:1,id:PACKAGE_ID,version:pkg.version,files:files.sort((a,b)=>a.path.localeCompare(b.path))});
}

export function validatePackage(bundle,expectedVersion){
  if(bundle?.format!==1||bundle.id!==PACKAGE_ID||!versionPattern.test(bundle.version)||expectedVersion&&bundle.version!==expectedVersion||!Array.isArray(bundle.files)||bundle.files.length>2000)throw Error('安装包信息无效');
  const names=new Set();let size=0;
  for(const file of bundle.files){
    if(!safePackagePath(file.path)||names.has(file.path.toLowerCase())||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data||''))throw Error('安装包包含无效或重复路径');
    names.add(file.path.toLowerCase());const bytes=Buffer.from(file.data,'base64');size+=bytes.length;
    if(size>48*1024*1024||sha256(bytes)!==file.sha256)throw Error('安装包校验失败');
    if(/\.(?:m?js|jsx|json|sh|ps1)$/i.test(file.path)&&/^(?:<{7}|>{7})(?: |\r?$)/m.test(bytes.toString('utf8')))throw Error('安装包包含未解决的合并冲突: '+file.path);
  }
  for(const name of required)if(!names.has(name.toLowerCase()))throw Error('安装包缺少必要文件: '+name);
  const json=name=>JSON.parse(Buffer.from(bundle.files.find(file=>file.path===name).data,'base64').toString('utf8'));
  for(const name of ['package.json','plugin.json']){const value=json(name);if(value.name!==PACKAGE_ID||value.version!==bundle.version)throw Error('安装包版本不一致');}
  if(json('sidecars/inspector/sidecar.json').env?.AGY_MAX_VERSION!==bundle.version)throw Error('伴生进程版本不一致');
  return bundle;
}

export function encodePackage(bundle){return gzipSync(Buffer.from(JSON.stringify(validatePackage(bundle))),{level:9});}
export function decodePackage(bytes,version){return validatePackage(JSON.parse(gunzipSync(bytes,{maxOutputLength:72*1024*1024}).toString('utf8')),version);}
export function writePackage(bundle,destination){
  validatePackage(bundle);mkdirSync(destination,{recursive:true});
  for(const file of bundle.files){const path=resolve(destination,...file.path.split('/')),rel=relative(destination,path);if(rel.startsWith('..')||isAbsolute(rel))throw Error('安装包路径越界');mkdirSync(dirname(path),{recursive:true});writeFileSync(path,Buffer.from(file.data,'base64'),{mode:file.path.endsWith('.sh')?0o755:0o644});}
  return {id:PACKAGE_ID,version:bundle.version,files:bundle.files.map(({path,sha256})=>({path,sha256}))};
}
