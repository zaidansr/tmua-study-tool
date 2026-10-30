import * as pdfjs from './vendor/pdfjs/pdf.mjs';
import {regionGeometry} from './pdf-geometry.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.mjs',import.meta.url).href;
const vendor = new URL('./vendor/pdfjs/',import.meta.url).href;
const documents = new Map(), rendered = new Map(), retired = new Set();
const SCALE = 2.3;

function releaseStaleImages() {
  const visible = new Set([...document.querySelectorAll('img')].map((image) => image.src));
  for (const url of retired) if (!visible.has(url)) { URL.revokeObjectURL(url); retired.delete(url); }
}

function documentFor(url) {
  if (!/^https:\/\/papers\.tmua\.local\/[a-zA-Z0-9._-]+\.pdf$/.test(url)) throw new Error('The PDF address is outside the local paper archive.');
  let entry = documents.get(url);
  if (!entry) {
    entry = {active:0,promise:(async () => {
      const source = window.TMUA_BROWSER ? {data:await window.TMUA_BROWSER.resolvePdf(url)} : {url};
      return pdfjs.getDocument({...source,disableRange:true,disableStream:true,isEvalSupported:false,cMapUrl:vendor+'cmaps/',cMapPacked:true,standardFontDataUrl:vendor+'standard_fonts/',wasmUrl:vendor+'wasm/'}).promise;
    })()};
    documents.set(url,entry);
    entry.promise.catch(() => { if (documents.get(url) === entry) documents.delete(url); });
  }
  documents.delete(url); documents.set(url,entry);
  return entry;
}

function trimWhite(canvas) {
  const context = canvas.getContext('2d',{willReadFrequently:true}), {width,height} = canvas;
  const pixels = context.getImageData(0,0,width,height).data;
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    // Ignore only nearly white outer padding; keep all visible equations/diagrams.
    if (pixels[i] < 233 || pixels[i+1] < 233 || pixels[i+2] < 233) {
      left = Math.min(left,x); right = Math.max(right,x); top = Math.min(top,y); bottom = Math.max(bottom,y);
    }
  }
  if (right < left) throw new Error('The original PDF region rendered empty.');
  const result = document.createElement('canvas'); result.width = right-left+1+40; result.height = bottom-top+1+40;
  const target = result.getContext('2d'); target.fillStyle = 'white'; target.fillRect(0,0,result.width,result.height);
  target.drawImage(canvas,left,top,right-left+1,bottom-top+1,20,20,right-left+1,bottom-top+1);
  return result;
}

async function renderRegion(region) {
  const geometry = regionGeometry(region,SCALE), entry = documentFor(region.pdf);
  entry.active++;
  try {
    const pdf = await entry.promise;
    if (region.page > pdf.numPages) throw new Error('The source PDF page is missing.');
    const page = await pdf.getPage(region.page);
    if (page.rotate !== 0) throw new Error('The source page rotation has changed.');
    const viewport = page.getViewport({scale:SCALE});
    if (Math.abs(viewport.width/SCALE-region.pageWidth) > 0.1 || Math.abs(viewport.height/SCALE-region.pageHeight) > 0.1) throw new Error('The source PDF page dimensions have changed.');
    const canvas = document.createElement('canvas'); canvas.width = geometry.width; canvas.height = geometry.height;
    await page.render({canvasContext:canvas.getContext('2d'),viewport,transform:geometry.transform,background:'rgb(255,255,255)'}).promise;
    const trimmed = trimWhite(canvas);
    const blob = await new Promise((resolve,reject) => trimmed.toBlob((result) => result ? resolve(result) : reject(new Error('The PDF image could not be created.')),'image/png'));
    return URL.createObjectURL(blob);
  } finally {
    entry.active--;
    // Keep a few parsed PDFs warm while bounding memory during long study sessions.
    for (const [url,older] of documents) {
      if (documents.size <= 6) break;
      if (older.active) continue;
      documents.delete(url); older.promise.then((pdf) => pdf.destroy()).catch(() => {});
    }
  }
}

function imageFor(region) {
  const key = JSON.stringify(region);
  let promise = rendered.get(key);
  if (!promise) {
    promise = renderRegion(region); rendered.set(key,promise);
    promise.catch(() => { if (rendered.get(key) === promise) rendered.delete(key); });
  }
  rendered.delete(key); rendered.set(key,promise);
  while (rendered.size > 24) {
    const [oldKey,oldPromise] = rendered.entries().next().value; rendered.delete(oldKey);
    oldPromise.then((url) => { retired.add(url); releaseStaleImages(); }).catch(() => {});
  }
  return promise;
}

async function mount(root) {
  await Promise.all([...root.querySelectorAll('[data-pdf-region]')].map(async (anchor) => {
    if (anchor.dataset.rendering) return;
    anchor.dataset.rendering = 'true';
    try {
      const url = await imageFor(JSON.parse(anchor.dataset.pdfRegion));
      if (!anchor.isConnected) return;
      const image = anchor.querySelector('img');
      image.addEventListener('error',() => {
        image.hidden = true;
        const note = document.createElement('span'); note.className = 'pdf-loading'; note.textContent = 'Could not display this region. Open its original PDF ↗'; anchor.append(note);
      },{once:true});
      image.src = url; image.hidden = false;
      anchor.querySelector('.pdf-loading')?.remove();
    } catch (error) {
      if (!anchor.isConnected) return;
      const label = anchor.querySelector('.pdf-loading');
      if (label) label.textContent = 'Could not render this region. Open its original PDF ↗';
      console.error('TMUA PDF render:',error);
    }
  }));
  releaseStaleImages();
}

document.addEventListener('click',(event) => {
  const anchor = event.target.closest('.pdf-region'), image = anchor?.querySelector('img');
  if (!image || image.hidden || !image.src) return;
  event.preventDefault();
  const zoom = document.getElementById('zoom-image'); zoom.src = image.src; zoom.alt = image.alt;
  document.getElementById('image-dialog').showModal();
});
window.TMUA_PDFRenderer = {mount};
window.dispatchEvent(new Event('tmua-pdf-ready'));
