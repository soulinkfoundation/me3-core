import { describe, expect, it, vi } from 'vitest';
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
  db.exec('CREATE TABLE sites (id TEXT PRIMARY KEY, username TEXT); CREATE TABLE site_files (site_id TEXT, path TEXT, content BLOB, content_type TEXT, size INTEGER, sha256 TEXT, updated_at TEXT, PRIMARY KEY(site_id,path))');
  db.exec("INSERT INTO sites VALUES ('a','alex'),('b','bea')");
  return { DB: { prepare(sql: string) { return { bind(...args: unknown[]) {
    const values = args.map(value => value instanceof ArrayBuffer ? new Uint8Array(value) : value) as never[];
    return { run: async () => ({meta: db.prepare(sql).run(...values)}), all: async () => ({ results: db.prepare(sql).all(...values) }), first: async () => db.prepare(sql).get(...values) || null };
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

import { getSiteFileText, putSiteFile, listSiteFiles } from './sites';
import { generateSiteHtml } from '@me3-core/site-renderer';

function dataImage(width = 1600, height = 900) {
  return `data:image/png;base64,${Buffer.from(png(width,height)).toString('base64')}`;
}
function transformations(env: Env) {
  let width = 0;
  const output = vi.fn(async () => ({response: () => new Response(webp(width, Math.round(width*900/1600)))}));
  env.IMAGES = {input: () => ({transform(options) { width = options.width!; return this; }, output})};
  return output;
}

// Synthetic SQLite storage; the Images service is simulated.
describe('embedded page images', () => {
  it('stores repeated images once and renders responsive URLs at every page depth', async () => {
    const env = imageEnv(), output = transformations(env);
    const source = `<p>About</p><img src="${dataImage()}" alt="Portrait" data-image-id="kept"><img src='${dataImage()}'>`;
    await putSiteFile(env,'a','src/about.md',source,'text/markdown');
    const saved = (await getSiteFileText(env,'a','src/about.md'))!;
    expect(saved).not.toContain('data:image');
    expect(saved).toContain('data-image-id="kept"');
    expect((await listSiteFiles(env,'a','public/files/content/')).length).toBe(1);
    expect(output).toHaveBeenCalledTimes(4);
    const images = await getSiteImageMetadata(env,{id:'a',username:'alex'} as DbSite);
    const generated = await generateSiteHtml({handle:'alex',pages:[{slug:'about',title:'About',file:'about.md'}]},[{name:'about.md',content:saved}],undefined,{baseUrl:'https://example.com/site/alex',images});
    expect(generated['about.html']).toContain('srcset=');
    expect(generated['about.html']).toContain('https://example.com/site/alex/files/responsive/');
    await putSiteFile(env,'a','public/blog/post.html',`<img src="${dataImage()}">`,'text/html');
    const published = (await getSiteFileText(env,'a','public/blog/post.html'))!;
    expect(published).toContain('src="../files/content/');
    expect(published).toContain('../files/responsive/');
    expect(output).toHaveBeenCalledTimes(4);
    expect(await getSiteImageMetadata(env,{id:'b',username:'bea'} as DbSite)).toEqual({});
  });

  it('migrates persisted snapshots on first read and keeps subsequent reads small', async () => {
    const env = imageEnv(); transformations(env);
    const bytes = new Uint8Array(520000); bytes.set(new Uint8Array(png(1600,900)));
    const original = `<img src="data:image/png;base64,${Buffer.from(bytes).toString('base64')}">`;
    await env.DB.prepare('INSERT INTO site_files (site_id,path,content,content_type,size,sha256) VALUES (?,?,?,?,?,?)')
      .bind('a','public/about/index.html',new TextEncoder().encode(original).buffer,'text/html',original.length,null).run();
    const migrated = (await getSiteFileText(env,'a','public/about/index.html'))!;
    expect(migrated.length).toBeLessThan(50000);
    expect(migrated).toContain('src="../files/content/');
    expect(migrated).toContain('srcset=');
    const raw = await env.DB.prepare('SELECT size FROM site_files WHERE site_id = ? AND path = ?').bind('a','public/about/index.html').first<{size:number}>();
    expect(raw!.size).toBeLessThan(50000);
    expect(await getSiteFileText(env,'a','public/about/index.html')).toBe(migrated);
  });

  it('keeps original bytes without Images and leaves unsupported or broken data URIs alone', async () => {
    const env = imageEnv();
    await putSiteFile(env,'a','src/about.md',`<img src="${dataImage(200,100)}"><img src="data:image/png;base64,broken!"><img src="data:image/svg+xml;base64,PHN2Zy8+">`,'text/markdown');
    const saved = (await getSiteFileText(env,'a','src/about.md'))!;
    expect(saved).toContain('/files/content/');
    expect(saved).toContain('data:image/png;base64,broken!');
    expect(saved).toContain('data:image/svg+xml');
    expect((await listSiteFiles(env,'a','public/files/responsive/')).length).toBe(0);
  });

  it('does not overwrite an edit made during migration', async () => {
    const env = imageEnv(), original = `<img src="${dataImage()}">`;
    const output = transformations(env);
    output.mockImplementationOnce(async () => {
      await env.DB.prepare('UPDATE site_files SET content = ? WHERE site_id = ? AND path = ?')
        .bind(new TextEncoder().encode('<p>New edit</p>').buffer,'a','public/about.html').run();
      return {response: () => new Response(webp(320,180))};
    });
    await env.DB.prepare('INSERT INTO site_files (site_id,path,content,content_type,size) VALUES (?,?,?,?,?)')
      .bind('a','public/about.html',new TextEncoder().encode(original).buffer,'text/html',original.length).run();
    expect(await getSiteFileText(env,'a','public/about.html')).toBe('<p>New edit</p>');
  });

  it('migrates old source files during an owner content listing without publishing them', async () => {
    const env = imageEnv(), original = `# About\n\n![Portrait](${dataImage(200,100)})`;
    await env.DB.prepare('INSERT INTO site_files (site_id,path,content,content_type,size) VALUES (?,?,?,?,?)')
      .bind('a','src/blog/about.md',new TextEncoder().encode(original).buffer,'text/markdown',original.length).run();
    const files = await listSiteFiles(env,'a','src/');
    const saved = new TextDecoder().decode(files[0].content as Uint8Array);
    expect(saved).not.toContain('data:image');
    expect(saved).toContain('![Portrait](/files/content/');
    expect(await getSiteFileText(env,'a','public/blog/about.html')).toBeNull();
  });

  it('keeps the original page if the image service fails', async () => {
    const env = imageEnv(), original = `<img src="${dataImage()}">`;
    transformations(env).mockRejectedValue(new Error('image service offline'));
    await env.DB.prepare('INSERT INTO site_files (site_id,path,content,content_type,size) VALUES (?,?,?,?,?)')
      .bind('a','public/about.html',new TextEncoder().encode(original).buffer,'text/html',original.length).run();
    expect(await getSiteFileText(env,'a','public/about.html')).toBe(original);
    await expect(putSiteFile(env,'a','public/about.html',original,'text/html')).rejects.toThrow('image service offline');
  });

  it('preserves the old page if migration cannot store media', async () => {
    const env = imageEnv(), original = `<img src="${dataImage()}">`;
    env.SITE_ASSETS = {put: vi.fn().mockRejectedValue(new Error('storage offline'))} as unknown as R2Bucket;
    await env.DB.prepare('INSERT INTO site_files (site_id,path,content,content_type,size) VALUES (?,?,?,?,?)')
      .bind('a','src/about.md',new TextEncoder().encode(original).buffer,'text/markdown',original.length).run();
    expect(await getSiteFileText(env,'a','src/about.md')).toBe(original);
    await expect(putSiteFile(env,'a','src/about.md',original,'text/markdown')).rejects.toThrow('storage offline');
  });
});
