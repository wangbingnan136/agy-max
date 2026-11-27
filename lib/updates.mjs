import { readFileSync } from 'node:fs';
import { releaseName } from './package.mjs';

export function projectInfo(){
  let config={};try{config=JSON.parse(readFileSync(new URL('../project.json',import.meta.url),'utf8'))||{};}catch{}
  return {name:typeof config.name==='string'&&config.name.trim()?config.name.trim().slice(0,80):'Antigravity Max',
    githubUrl:typeof config.githubUrl==='string'?config.githubUrl:'',subscriptionUrl:typeof config.subscriptionUrl==='string'?config.subscriptionUrl:''};
}

export function githubRepository(url){
  try{const value=new URL(url),match=value.pathname.match(/^\/([\w.-]+)\/([\w.-]+?)\/?$/),repo=match?.[2].replace(/\.git$/,'');if(value.protocol==='https:'&&value.hostname==='github.com'&&!value.port&&!value.username&&!value.password&&!value.search&&!value.hash&&match&&repo)return {owner:match[1],repo};}catch{}
  return null;
}

export function compareVersions(a,b){
  const parse=value=>String(value).trim().match(/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  const x=parse(a),y=parse(b);if(!x||!y)return null;
  for(let i=1;i<=3;i++){const left=BigInt(x[i]),right=BigInt(y[i]);if(left!==right)return left>right?1:-1;}
  if(!x[4]&&!y[4])return 0;if(!x[4])return 1;if(!y[4])return -1;
  const left=x[4].split('.'),right=y[4].split('.');
  for(let i=0;i<Math.max(left.length,right.length);i++){
    if(left[i]===undefined)return -1;if(right[i]===undefined)return 1;if(left[i]===right[i])continue;
    const ln=/^\d+$/.test(left[i]),rn=/^\d+$/.test(right[i]);
    if(ln&&rn)return BigInt(left[i])>BigInt(right[i])?1:-1;
    if(ln!==rn)return ln?-1:1;return left[i]>right[i]?1:-1;
  }
  return 0;
}

export async function checkForUpdates({currentVersion,project=projectInfo(),fetcher=fetch}={}){
  const repo=githubRepository(project.githubUrl);
  if(!project.githubUrl)return {status:'unconfigured',currentVersion};
  if(!repo)return {status:'invalid-config',currentVersion};
  const response=await fetcher(`https://api.github.com/repos/${repo.owner}/${repo.repo}/releases/latest`,{
    headers:{Accept:'application/vnd.github+json','User-Agent':'agy-max/'+currentVersion},signal:AbortSignal.timeout(7000),redirect:'error'
  });
  if(response.status===404)return {status:'no-release',currentVersion};
  if(response.status===403||response.status===429)return {status:'rate-limited',currentVersion};
  if(!response.ok)throw new Error('更新服务暂时不可用');
  const content=await response.text();if(content.length>1024*1024)throw new Error('更新信息过大');
  const release=JSON.parse(content),comparison=compareVersions(release.tag_name,currentVersion);
  if(release.draft||release.prerelease||comparison===null)return {status:'unsupported-release',currentVersion};
  const version=release.tag_name.replace(/^v/,'');
  const packageName=releaseName(version),assets=Array.isArray(release.assets)?release.assets:[];
  const asset=assets.find(item=>item.name===packageName&&item.state==='uploaded'),checksum=assets.find(item=>item.name===packageName+'.sha256'&&item.state==='uploaded');
  const base=`https://github.com/${repo.owner}/${repo.repo}/releases/download/${encodeURIComponent(release.tag_name)}/`;
  const digest=asset?.digest?.match?.(/^sha256:([a-f0-9]{64})$/i)?.[1]?.toLowerCase();
  return {status:comparison>0?'available':'current',currentVersion,version,
    releaseUrl:`https://github.com/${repo.owner}/${repo.repo}/releases/tag/${encodeURIComponent(release.tag_name)}`,
    notes:typeof release.body==='string'?release.body.slice(0,12000):'',canInstall:!!asset&&!!(digest||checksum),
    asset:asset?{name:packageName,url:base+encodeURIComponent(packageName),sha256:digest,checksumUrl:checksum?base+encodeURIComponent(checksum.name):undefined}:undefined};
}
