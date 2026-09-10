import { describe, expect, it } from 'vitest';
import { imageDimensions, saveUploadedImageMetadata, getSiteImageMetadata } from './site-images';
import type { DbSite, Env } from './types';

function png(width: number, height: number) {
  const bytes = new Uint8Array(24); bytes.set([137,80,78,71,13,10,26,10]);
  const view = new DataView(bytes.buffer); view.setUint32(16,width); view.setUint32(20,height); return bytes.buffer;
}

describe('image dimensions', () => {
  it('respects the displayed orientation of camera JPEGs', () => {
    const bytes = new Uint8Array(48), view = new DataView(bytes.buffer);
    bytes.set([255,216,255,225,0,34]);
    bytes.set(new TextEncoder().encode('Exif\0\0II'),6);
    view.setUint16(14,42,true); view.setUint32(16,8,true); view.setUint16(20,1,true);
    view.setUint16(22,0x112,true); view.setUint16(24,3,true); view.setUint32(26,1,true); view.setUint16(30,6,true);
    bytes.set([255,192,0,8,8,1,144,2,128,0],38);
    expect(imageDimensions(bytes.buffer)).toEqual({width:400,height:640});
    view.setUint32(16,0xffffffff,true);
    expect(imageDimensions(bytes.buffer)).toEqual({width:640,height:400});
  });
  it('reads real dimensions and rejects truncated or unsupported files', () => {
    expect(imageDimensions(png(1600,900))).toEqual({width:1600,height:900});
    expect(imageDimensions(new Uint8Array([255,216,255]).buffer)).toBeNull();
    expect(imageDimensions(new TextEncoder().encode('<svg/>').buffer)).toBeNull();
    const jpeg = new Uint8Array([255,216,255,192,0,8,8,1,144,2,128,0]);
    expect(imageDimensions(jpeg.buffer)).toEqual({width:640,height:400});
  });
});

import { DatabaseSync } from 'node:sqlite';
function imageEnv(): Env {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE site_files (site_id TEXT, path TEXT, content BLOB, content_type TEXT, size INTEGER, sha256 TEXT, updated_at TEXT, PRIMARY KEY(site_id,path))');
  return { DB: { prepare(sql: string) { return { bind(...args: unknown[]) {
    const values = args.map(value => value instanceof ArrayBuffer ? new Uint8Array(value) : value) as never[];
    return { run: async () => db.prepare(sql).run(...values), all: async () => ({ results: db.prepare(sql).all(...values) }), first: async () => db.prepare(sql).get(...values) || null };
  } }; } } } as unknown as Env;
}
function webp(width: number, height: number) {
  const bytes = new Uint8Array(30);
  bytes.set(new TextEncoder().encode('RIFF'),0); bytes.set(new TextEncoder().encode('WEBPVP8X'),8);
  const view = new DataView(bytes.buffer); view.setUint32(4,22,true);
  bytes[24]=(width-1)&255; bytes[25]=(width-1)>>8; bytes[27]=(height-1)&255; bytes[28]=(height-1)>>8;
  return bytes.buffer;
}

describe('uploaded responsive image metadata', () => {
  it('stores verified variants without losing concurrent uploads or mixing sites', async () => {
    const env = imageEnv(), site = { id:'a', username:'alex' } as DbSite;
    const form = new FormData();
    form.set('variant-320',new File([webp(320,180)],'small.webp',{type:'image/webp'}));
    form.set('variant-640',new File([webp(640,640)],'wrong-ratio.webp',{type:'image/webp'}));
    await Promise.all([
      saveUploadedImageMetadata(env,site,'files/hero.png',png(1600,900),form),
      saveUploadedImageMetadata(env,site,'files/avatar.png',png(200,200)),
    ]);
    const images = await getSiteImageMetadata(env,site);
    expect(Object.keys(images)).toHaveLength(2);
    expect(images['files/hero.png'].variants).toEqual([{path:expect.stringMatching(/^files\/responsive\/[a-f0-9]{64}\.webp$/),width:320}]);
    expect(await getSiteImageMetadata(env,{...site,id:'b'})).toEqual({});
  });
});
