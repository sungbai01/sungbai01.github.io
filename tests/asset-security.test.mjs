// Run: node --test tests/asset-security.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { deflateRawSync } from 'node:zlib';
import { zipSync } from 'fflate';

// Bundle in memory to resolve the application's extensionless TS imports.
const require = createRequire(new URL('../auth-worker/package.json', import.meta.url));
const { build } = require('esbuild');
const bundled = await build({ entryPoints: ['src/lib/assets.ts'], bundle: true,
  platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
const { importAssetFile } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`);
const MiB = 1024 * 1024;
const jpeg = Buffer.from([255, 216, 255, 224, 0, 2, 255, 217]);
const card = Buffer.from(JSON.stringify({ spec: 'chara_card_v3', data: { name: 'Fixture',
  assets: [{ type: 'icon', name: 'Portrait', uri: 'embeded://portrait.jpg', ext: 'jpg' }] } }));
const load = (bytes, name = 'fixture.charx') => importAssetFile(new File([bytes], name));

// Tiny real ZIP32 payloads with deliberately independent declared output sizes.
// This never creates the declared large output in the test process.
function syntheticZip(entries) {
  const locals = [], directory = [];
  let offset = 0;
  for (const { name: filename, size, body = Buffer.from('{}'), method = 8 } of entries) {
    const name = Buffer.from(filename), data = method === 8 ? deflateRawSync(body) : body;
    const local = Buffer.alloc(30), central = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(size, 22); local.writeUInt16LE(name.length, 26);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(method, 10);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, name, data); directory.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const end = Buffer.alloc(22), central = Buffer.concat(directory);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}

async function rejectsBeforeAllocation(entries) {
  const archive = syntheticZip(entries);
  const Native = globalThis.Uint8Array;
  const requests = [];
  globalThis.Uint8Array = new Proxy(Native, { construct(target, args) {
    if (typeof args[0] === 'number' && args[0] > MiB) {
      requests.push(args[0]);
      throw new Error('test intercepted large allocation');
    }
    return Reflect.construct(target, args, target);
  } });
  try {
    await assert.rejects(load(archive), /card.json/);
    assert.deepEqual(requests, [], 'reject declarations before attempting a large allocation');
  } finally { globalThis.Uint8Array = Native; }
}

test('tiny 4 GiB card.json declaration is rejected before allocation', async () => {
  await rejectsBeforeAllocation([{ name: 'card.json', size: 0xfffffffe }]);
});

test('valid card metadata and image above the previous fixed limits import unchanged', async () => {
  const metadata = Buffer.from(JSON.stringify({...JSON.parse(card),padding:'x'.repeat(2 * MiB + 1)}));
  const image = Buffer.alloc(33 * MiB); image.set(jpeg);
  const result = await load(zipSync({'card.json':metadata,'portrait.jpg':image}));
  assert.equal(result.assets.length,1);
  const decoded=Buffer.from(result.assets[0].src.split(',')[1],'base64');
  assert.equal(decoded.length,image.length);assert.deepEqual(decoded,image);
});

test('unused entries above the former aggregate cap are not decompressed or allocated', async () => {
  const archive=zipSync({'card.json':card,'portrait.jpg':jpeg,...Object.fromEntries(Array.from({length:5},(_,i)=>[`unused-${i}.jpg`,Buffer.from('unused')]))});
  const view=new DataView(archive.buffer,archive.byteOffset,archive.byteLength);
  for(let i=0;i<archive.length-46;i++)if(view.getUint32(i,true)===0x02014b50){
    const name=new TextDecoder().decode(archive.subarray(i+46,i+46+view.getUint16(i+28,true)));
    if(name.startsWith('unused-'))view.setUint32(i+24,33 * MiB,true);
  }
  const result=await load(archive);assert.equal(result.assets.length,1);
});

test('actual inflated output cannot exceed a small forged declaration', async () => {
  // Keep a valid card CRC and forge only the image's declared output size.
  const valid = zipSync({ 'card.json': card, 'portrait.jpg': Buffer.alloc(128 * 1024, 65) });
  const view = new DataView(valid.buffer, valid.byteOffset, valid.byteLength);
  for (let i = 0; i < valid.length - 46; i++) {
    if (view.getUint32(i, true) === 0x02014b50 &&
      new TextDecoder().decode(valid.subarray(i + 46, i + 46 + view.getUint16(i + 28, true))) === 'portrait.jpg') {
      view.setUint32(i + 24, 1, true); break;
    }
  }
  await assert.rejects(load(valid), /압축 해제 크기가 선언된 크기/);
});

test('module.risum real output is bounded even on the optional warning path', async () => {
  const archive = zipSync({ 'card.json': card, 'portrait.jpg': jpeg,
    'module.risum': Buffer.alloc(128 * 1024, 65) });
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  for (let i = 0; i < archive.length - 46; i++) {
    if (view.getUint32(i, true) === 0x02014b50 &&
      new TextDecoder().decode(archive.subarray(i + 46, i + 46 + view.getUint16(i + 28, true))) === 'module.risum') {
      view.setUint32(i + 24, 1, true); break;
    }
  }
  const result = await load(archive);
  assert.equal(result.assets.length, 1);
  assert.ok(result.warnings.some(warning => warning.includes('module.risum')));
});

test('stored and deflated valid CHARX and appended JPEG+CHARX still import', async () => {
  for (const level of [0, 6]) {
    const archive = zipSync({ 'card.json': card, 'portrait.jpg': jpeg }, { level });
    for (const bytes of [archive, Buffer.concat([jpeg, archive])]) {
      const result = await load(bytes);
      assert.equal(result.assets[0].name, 'Portrait');
      assert.equal(result.assets[0].src, `data:image/jpeg;base64,${jpeg.toString('base64')}`);
    }
  }
  assert.equal((await load(jpeg, 'portrait.jpg')).assets.length, 1);
});

test('CRC and truncated-output failures remain enforced', async () => {
  for (const method of [0, 8]) {
    await assert.rejects(load(syntheticZip([{ name: 'card.json', size: card.length, body: card, method }])), /card.json/);
  }
  await assert.rejects(load(syntheticZip([{ name: 'card.json', size: card.length + 1, body: card }])), /card.json/);
});
