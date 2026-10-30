const PDF_PREFIX = [37,80,68,70,45];
const LOCAL_PDF = /^https:\/\/papers\.tmua\.local\/([A-Za-z0-9._-]+\.pdf)(?:#.*)?$/;

export async function sha256(bytes, subtle = globalThis.crypto?.subtle) {
  if (!subtle) throw new Error('This browser needs a secure HTTPS page to verify the papers.');
  const digest = await subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2,'0')).join('');
}

export async function verifyPdf(source, value, subtle) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  if (bytes.byteLength !== source.bytes || PDF_PREFIX.some((byte,index) => bytes[index] !== byte)) throw new Error('This file does not match the original official PDF.');
  if (await sha256(bytes,subtle) !== source.sha256) throw new Error('This file has changed or is not the expected official PDF.');
  return bytes;
}

export class IndexedDbPaperStore {
  constructor(indexedDB = globalThis.indexedDB) { this.indexedDB = indexedDB; this.database = null; }
  async open() {
    if (!this.indexedDB) throw new Error('Local PDF storage is unavailable. Open this page in a regular browser window.');
    if (!this.database) this.database = new Promise((resolve,reject) => {
      const request = this.indexedDB.open('tmua-official-papers-v1',1);
      request.onupgradeneeded = () => request.result.createObjectStore('papers',{keyPath:'path'});
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('The browser could not open local PDF storage. Check its storage settings.'));
      request.onblocked = () => reject(new Error('Close other tabs using this study tool and reload to update local storage.'));
    });
    return this.database;
  }
  async transaction(mode, action) {
    const database = await this.open();
    return new Promise((resolve,reject) => {
      const transaction = database.transaction('papers',mode);
      let result;
      try {
        const request = action(transaction.objectStore('papers'));
        request.onsuccess = () => { result = request.result; };
      } catch (error) { reject(error); return; }
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = transaction.onerror = () => reject(new Error('The browser could not save a PDF. Check available storage space and try again.'));
    });
  }
  get(path) { return this.transaction('readonly',(store) => store.get(path)); }
  put(record) { return this.transaction('readwrite',(store) => store.put(record)); }
  delete(path) { return this.transaction('readwrite',(store) => store.delete(path)); }
}

export class PaperRepository {
  constructor(sources, store = new IndexedDbPaperStore(), subtle) {
    if (!Array.isArray(sources) || !sources.length) throw new Error('The source manifest is missing.');
    this.sources = sources; this.store = store; this.subtle = subtle; this.available = new Set();
    this.byPath = new Map(sources.map((source) => [source.path,source]));
    this.byHash = new Map(sources.map((source) => [source.sha256,source]));
  }
  sourceFor(url) {
    const match = String(url).match(LOCAL_PDF), source = match && this.byPath.get('papers/'+match[1]);
    if (!source) throw new Error('This PDF is outside the official paper manifest.');
    return source;
  }
  hasPdf(url) { try { return this.available.has(this.sourceFor(url).path); } catch (_) { return false; } }
  get ready() { return this.sources.some((source) => source.kind === 'question' && this.available.has(source.path)); }
  async inspect(onValid = () => {}) {
    this.available.clear();
    for (const source of this.sources) {
      const record = await this.store.get(source.path);
      if (!record) continue;
      try { const bytes = await verifyPdf(source,record.bytes,this.subtle); this.available.add(source.path); onValid(source,bytes); }
      catch (_) { await this.store.delete(source.path); }
    }
    return {completed:this.available.size,total:this.sources.length,ready:this.ready};
  }
  async importFiles(files, progress = () => {}) {
    let accepted = 0, rejected = 0;
    const errors = [];
    const largest = Math.max(...this.sources.map((source) => source.bytes));
    for (const file of files) {
      try {
        if (file.size > largest || file.size < 5) throw new Error('This is not one of the original archive PDFs.');
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (PDF_PREFIX.some((byte,index) => bytes[index] !== byte)) throw new Error('This file is not a PDF.');
        const source = this.byHash.get(await sha256(bytes,this.subtle));
        if (!source || bytes.byteLength !== source.bytes) throw new Error('This file is not a matching original official PDF.');
        await this.store.put({path:source.path,bytes:bytes.slice().buffer});
        this.available.add(source.path); accepted++;
      } catch (error) { rejected++; errors.push(`${file.name || 'PDF'}: ${error.message}`); }
      progress({completed:this.available.size,total:this.sources.length,accepted,rejected});
    }
    return {completed:this.available.size,total:this.sources.length,ready:this.ready,accepted,rejected,errors};
  }
  async readPdf(url) {
    const source = this.sourceFor(url), record = await this.store.get(source.path);
    if (!record) { this.available.delete(source.path); throw new Error(`Import ${source.path.slice(7)} to view this PDF.`); }
    try { return (await verifyPdf(source,record.bytes,this.subtle)).slice(); }
    catch (_) { this.available.delete(source.path); await this.store.delete(source.path); throw new Error(`The stored PDF is damaged. Import ${source.path.slice(7)} again.`); }
  }
}
