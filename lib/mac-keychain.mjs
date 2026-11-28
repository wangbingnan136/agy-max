// macOS Keychain helpers shared by credential-vault.mjs and ssh-vault.mjs.
//
// buildMacKeychainWriteScript is copied verbatim from
// WhiteBr1ck/agy-powertools v2.16.10 lib/credential-vault.mjs (MIT License,
// Copyright (c) 2026 WhiteBr1ck), the final fix for upstream issue #75. It writes
// through Security.framework over JXA stdin and sets the partition ACL
// (apple-tool:, apple:, Google teamid) so Antigravity can read the item silently.
//
// Why: `/usr/bin/security -i` reads each command into a ~4096-byte buffer; with 2x hex
// expansion any secret over ~2 KB is split into an "unknown command" and never stored
// (reproduced on a throwaway keychain, 2026-11-27).
import { spawnSync } from 'node:child_process';

export function buildMacKeychainReadScript({ service, account }) {
  return [
    "ObjC.import('Foundation');",
    "ObjC.import('Security');",
    "ObjC.import('stdlib');",
    "let step = 'init';",
    'try {',
    "  if (typeof ObjC.bindFunction === 'function') {",
    "    ObjC.bindFunction('SecKeychainSetUserInteractionAllowed', ['int', ['bool']]);",
    "    ObjC.bindFunction('SecItemCopyMatching', ['int', ['id', 'id*']]);",
    '  }',
    "  if (typeof $.SecKeychainSetUserInteractionAllowed === 'function') $.SecKeychainSetUserInteractionAllowed(false);",
    "  const isRef = v => Boolean(v) && (Object.prototype.toString.call(v) === '[object Ref]' || String(v) === '[object Ref]');",
    "  const toObj = v => (isRef(v) && typeof ObjC.castRefToObject === 'function' ? ObjC.castRefToObject(v) : v);",
    `  const service = $(${JSON.stringify(String(service || ''))});`,
    `  const account = $(${JSON.stringify(String(account || ''))});`,
    "  const kClass = toObj($.kSecClass) || $('class');",
    "  const kGenp = toObj($.kSecClassGenericPassword) || $('genp');",
    "  const kSvc = toObj($.kSecAttrService) || $('svce');",
    "  const kAcct = toObj($.kSecAttrAccount) || $('acct');",
    "  const kRetData = toObj($.kSecReturnData) || $('r_Data');",
    "  const kMatchLimit = toObj($.kSecMatchLimit) || $('m_Limit');",
    "  const kMatchOne = toObj($.kSecMatchLimitOne) || $('m_LimitOne');",
    '  const query = $.NSMutableDictionary.alloc.init;',
    '  query.setObjectForKey(kGenp, kClass);',
    '  query.setObjectForKey(service, kSvc);',
    '  query.setObjectForKey(account, kAcct);',
    '  query.setObjectForKey($.NSNumber.numberWithBool(true), kRetData);',
    '  query.setObjectForKey(kMatchOne, kMatchLimit);',
    "  step = 'copy-matching';",
    '  const outRef = Ref();',
    '  const status = $.SecItemCopyMatching(query, outRef);',
    '  if (status !== 0) { console.log(step + " OSStatus " + status); $.exit(1); }',
    '  const dataObj = toObj(outRef[0]);',
    '  if (!dataObj || (typeof dataObj.isNil === \'function\' && dataObj.isNil())) { console.log("empty data"); $.exit(1); }',
    '  const b64 = ObjC.unwrap(dataObj.base64EncodedStringWithOptions(0));',
    '  const outData = $(b64 + "\\n").dataUsingEncoding($.NSUTF8StringEncoding);',
    '  $.NSFileHandle.fileHandleWithStandardOutput.writeData(outData);',
    '} catch (e) {',
    '  console.log(step + " exception: " + e);',
    '  $.exit(1);',
    '}'
  ].join('\n') + '\n';
}

export function buildMacKeychainWriteScript({ service, account, dataBase64 }) {
  return [
    "ObjC.import('Foundation');",
    "ObjC.import('Security');",
    "ObjC.import('stdlib');",
    "let step = 'init';",
    'try {',
    "  if (typeof ObjC.bindFunction === 'function') {",
    "    ObjC.bindFunction('SecItemUpdate', ['int', ['id', 'id']]);",
    "    ObjC.bindFunction('SecItemAdd', ['int', ['id', 'void*']]);",
    "    ObjC.bindFunction('SecTrustedApplicationCreateFromPath', ['int', ['string', 'id*']]);",
    "    ObjC.bindFunction('SecAccessCreate', ['int', ['id', 'id', 'id*']]);",
    "    ObjC.bindFunction('SecAccessCopyMatchingACLList', ['id', ['id', 'id']]);",
    "    ObjC.bindFunction('SecACLSetContents', ['int', ['id', 'void*', 'id', 'int']]);",
    "    ObjC.bindFunction('SecACLCreateWithSimpleContents', ['int', ['id', 'void*', 'id', 'int', 'id*']]);",
    "    ObjC.bindFunction('SecACLUpdateAuthorizations', ['int', ['id', 'id']]);",
    "    ObjC.bindFunction('SecCopyErrorMessageString', ['id', ['int', 'void*']]);",
    '  }',
    "  const isRef = v => Boolean(v) && (Object.prototype.toString.call(v) === '[object Ref]' || String(v) === '[object Ref]');",
    "  const toObj = v => (isRef(v) && typeof ObjC.castRefToObject === 'function' ? ObjC.castRefToObject(v) : v);",
    `  const service = $(${JSON.stringify(String(service || ''))});`,
    `  const account = $(${JSON.stringify(String(account || ''))});`,
    `  const data = $.NSData.alloc.initWithBase64EncodedStringOptions($(${JSON.stringify(String(dataBase64 || ''))}), 0);`,
    '  if (!data || data.isNil()) { console.log("invalid base64 payload"); $.exit(1); }',
    "  step = 'constants';",
    "  const kClass = toObj($.kSecClass) || $('class');",
    "  const kGenp = toObj($.kSecClassGenericPassword) || $('genp');",
    "  const kSvc = toObj($.kSecAttrService) || $('svce');",
    "  const kAcct = toObj($.kSecAttrAccount) || $('acct');",
    "  const kVal = toObj($.kSecValueData) || $('v_Data');",
    '  const kAccess = toObj($.kSecAttrAccess);',
    '  const query = $.NSMutableDictionary.alloc.init;',
    '  query.setObjectForKey(kGenp, kClass);',
    '  query.setObjectForKey(service, kSvc);',
    '  query.setObjectForKey(account, kAcct);',
    '  const attrs = $.NSMutableDictionary.alloc.init;',
    '  attrs.setObjectForKey(data, kVal);',
    "  step = 'update';",
    '  let status = $.SecItemUpdate(query, attrs);',
    '  if (status === -25300) {',
    '    const addQuery = query.mutableCopy;',
    '    addQuery.setObjectForKey(data, kVal);',
    '    const list = $.NSMutableArray.alloc.init;',
    "    for (const path of ['/usr/bin/osascript', '/usr/bin/security']) {",
    "      step = path === '/usr/bin/security' ? 'trusted-security' : 'trusted-self';",
    '      const app = Ref();',
    '      status = $.SecTrustedApplicationCreateFromPath(path, app);',
    '      if (status !== 0) break;',
    '      list.addObject(toObj(app[0]));',
    '    }',
    '    if (status === 0) {',
    "      step = 'access';",
    '      const access = Ref();',
    '      status = $.SecAccessCreate(service, list, access);',
    '      if (status === 0) {',
    '        const accessObj = toObj(access[0]);',
    "        const kPart = toObj($.kSecACLAuthorizationPartitionID) || $('ACLAuthorizationPartitionID');",
    '        const partitionXml = $(\'<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Partitions</key><array><string>apple-tool:</string><string>apple:</string><string>teamid:EQHXZ8M8AV</string></array></dict></plist>\');',
    '        const existingAcls = $.SecAccessCopyMatchingACLList(accessObj, kPart);',
    '        if (existingAcls && (!existingAcls.isNil || !existingAcls.isNil()) && existingAcls.count > 0) {',
    "          step = 'partition-update';",
    '          status = $.SecACLSetContents(existingAcls.objectAtIndex(0), null, partitionXml, 0);',
    '        } else {',
    "          step = 'partition-create';",
    '          const aclRef = Ref();',
    '          status = $.SecACLCreateWithSimpleContents(accessObj, null, partitionXml, 0, aclRef);',
    '          if (status === 0) {',
    "            step = 'partition-auth';",
    '            const auths = $.NSMutableArray.alloc.init;',
    '            auths.addObject(kPart);',
    '            status = $.SecACLUpdateAuthorizations(toObj(aclRef[0]), auths);',
    '          }',
    '        }',
    '        if (status === 0) {',
    '          if (!kAccess) { status = -50; }',
    '          else {',
    "            step = 'add';",
    '            addQuery.setObjectForKey(accessObj, kAccess);',
    '            status = $.SecItemAdd(addQuery, null);',
    "            if (status === -25299) { step = 'update-after-dup'; status = $.SecItemUpdate(query, attrs); }",
    '          }',
    '        }',
    '      }',
    '    }',
    '  }',
    '  if (status !== 0) {',
    "    const errRef = typeof $.SecCopyErrorMessageString === 'function' ? $.SecCopyErrorMessageString(status, null) : null;",
    '    const errObj = errRef ? toObj(errRef) : null;',
    "    const msg = errObj ? (typeof ObjC.unwrap === 'function' ? ObjC.unwrap(errObj) : String(errObj)) : '';",
    '    console.log(step + " OSStatus " + status + (msg ? ": " + msg : ""));',
    '    $.exit(1);',
    '  }',
    '} catch (e) {',
    '  console.log(step + " exception: " + e);',
    '  $.exit(1);',
    '}'
  ].join('\n') + '\n';
}

// Keep each `/usr/bin/security -i` line well under its ~4096-byte read buffer.
export const SECURITY_LINE_BUDGET = 3800;

export function planMacKeychainWrite({ service, account, buf }) {
  const head = `add-generic-password -U -s ${JSON.stringify(String(service))} -a ${JSON.stringify(String(account))}`;
  const hexInput = `${head} -X ${buf.toString('hex')}\n`;
  if (Buffer.byteLength(hexInput, 'utf8') < SECURITY_LINE_BUDGET) {
    return { tier: 'hex', command: '/usr/bin/security', args: ['-i'], input: hexInput };
  }
  // Printable ASCII (typical JSON token envelopes) skips the 2x hex expansion.
  // Quotes and backslashes are excluded so the interactive parser cannot misread them.
  const text = buf.toString('utf8');
  if (/^[\x20-\x7e]+$/.test(text) && !/['\\]/.test(text) && Buffer.from(text, 'utf8').equals(buf)) {
    const textInput = `${head} -w '${text}'\n`;
    if (Buffer.byteLength(textInput, 'utf8') < SECURITY_LINE_BUDGET) {
      return { tier: 'text', command: '/usr/bin/security', args: ['-i'], input: textInput };
    }
  }
  // Anything larger goes through Security.framework over JXA stdin, never argv.
  return {
    tier: 'jxa',
    command: '/usr/bin/osascript',
    args: ['-l', 'JavaScript'],
    input: buildMacKeychainWriteScript({ service, account, dataBase64: buf.toString('base64') })
  };
}

export function writeMacGenericPassword({ service, account, buf, runSpawn = spawnSync, timeout = 8000 }) {
  const plan = planMacKeychainWrite({ service, account, buf });
  const res = runSpawn(plan.command, plan.args, { input: plan.input, stdio: ['pipe', 'ignore', 'pipe'], timeout });
  const stderr = String(res?.stderr || '').trim();
  // `security -i` can report a split command on stderr; never treat that as success.
  if (res?.error || res?.status !== 0 || /unknown command/i.test(stderr)) {
    return { ok: false, tier: plan.tier, error: res?.error?.message || stderr || '写入 macOS 钥匙串失败' };
  }
  return { ok: true, tier: plan.tier };
}
