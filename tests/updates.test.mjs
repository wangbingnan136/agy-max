import test from 'node:test';
import assert from 'node:assert/strict';
import {checkForUpdates,compareVersions,githubRepository} from '../lib/updates.mjs';
import {PACKAGE_ITEMS,releaseName} from '../lib/package.mjs';

test('release comparison uses version numbers and stable/prerelease ordering',()=>{
  assert.equal(compareVersions('v2.11.0','2.9.9'),1);assert.equal(compareVersions('2.11.0','2.11.0'),0);
  assert.equal(compareVersions('2.10.0','2.11.0'),-1);assert.equal(compareVersions('2.11.0','2.11.0-rc.1'),1);
  assert.equal(compareVersions('2.11.0-rc.10','2.11.0-rc.2'),1);assert.equal(compareVersions('garbage','2.11.0'),null);
});

test('unconfigured or invalid repositories make no network request',async()=>{
  const fetcher=()=>{throw Error('Unexpected request');};
  assert.equal((await checkForUpdates({currentVersion:'2.11.0',project:{githubUrl:''},fetcher})).status,'unconfigured');
  for(const githubUrl of ['https://example.com/owner/repo','http://github.com/owner/repo','https://token@github.com/owner/repo']){
    assert.equal((await checkForUpdates({currentVersion:'2.11.0',project:{githubUrl},fetcher})).status,'invalid-config');
  }
  assert.deepEqual(githubRepository('https://github.com/owner/repo.git'),{owner:'owner',repo:'repo'});
});

test('update check queries only published releases and reports unavailable versions and failures honestly',async()=>{
  const options={currentVersion:'2.11.0',project:{githubUrl:'https://github.com/owner/repo'}};
  const fetcher=async(url,config)=>{assert.equal(url,'https://api.github.com/repos/owner/repo/releases/latest');assert.ok(config.signal);return new Response(JSON.stringify({tag_name:'v2.12.0',body:'Release notes',html_url:'https://untrusted.example/download'}));};
  const result=await checkForUpdates({...options,fetcher});assert.equal(result.status,'available');assert.equal(result.version,'2.12.0');assert.equal(result.notes,'Release notes');assert.equal(result.releaseUrl,'https://github.com/owner/repo/releases/tag/v2.12.0');
  for(const [code,status] of [[404,'no-release'],[429,'rate-limited'],[403,'rate-limited']])assert.equal((await checkForUpdates({...options,fetcher:async()=>new Response('',{status:code})})).status,status);
  assert.equal((await checkForUpdates({...options,fetcher:async()=>new Response(JSON.stringify({tag_name:'v2.11.0'}))})).status,'current');
  assert.equal((await checkForUpdates({...options,fetcher:async()=>new Response(JSON.stringify({tag_name:'v2.12.0',prerelease:true}))})).status,'unsupported-release');
  await assert.rejects(()=>checkForUpdates({...options,fetcher:async()=>{throw Error('offline');}}),/offline/);
  await assert.rejects(()=>checkForUpdates({...options,fetcher:async()=>new Response('{bad json')}));
});

test('auto-update only installs the current package format, so v1.4.1 clients fall back to the download page',async()=>{
  const asset=name=>({name,state:'uploaded',digest:'sha256:'+'a'.repeat(64)});
  const check=assets=>checkForUpdates({currentVersion:'1.4.1',project:{githubUrl:'https://github.com/owner/repo'},fetcher:async()=>new Response(JSON.stringify({tag_name:'v1.4.2',assets}))});
  assert.equal(releaseName('1.4.2'),'agy-max-v1.4.2.pkg.gz');
  const current=await check([asset('agy-max-v1.4.2.pkg.gz')]);
  assert.equal(current.canInstall,true);assert.equal(current.asset.name,'agy-max-v1.4.2.pkg.gz');
  assert.equal((await check([asset('agy-max-v1.4.2.bundle.gz')])).canInstall,false);
});

test('package top-level layout is frozen for the current asset name',()=>{
  // Older updaters reject unknown top-level entries. If this list changes, rename releaseName() in lib/package.mjs too.
  assert.deepEqual(PACKAGE_ITEMS,['packages','vendor','ui','assets','rules','skills','sidecars','lib','scripts','docs','package.json','package-lock.json','plugin.json','hooks.json','mcp_config.json','project.json','README.md','README_EN.md','LICENSE','install.ps1','uninstall.ps1','install.sh','uninstall.sh']);
});
