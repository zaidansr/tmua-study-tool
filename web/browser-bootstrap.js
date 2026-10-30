'use strict';

// The desktop host injects its readiness flag before scripts run. Other browsers
// keep their own original PDF copies in IndexedDB under this site's origin.
if (!(typeof window.TMUA_CONTENT_READY === 'boolean' && location.origin === 'https://tmua.local')) {
  window.TMUA_CONTENT_READY = false;
  window.TMUA_BOOT = (async () => {
    const adapter = window.TMUA_BROWSER = {status:{completed:0,total:45},error:'',hasPdf:() => false};
    try {
      const {PaperRepository} = await import('./browser-store.mjs');
      const response = await fetch('data/sources.json');
      if (!response.ok) throw new Error('The official paper list could not load. Reload this page to try again.');
      const manifest = await response.json(), repository = new PaperRepository(manifest.sources);
      const objectUrls = new Map();
      adapter.repository = repository;
      try {
        adapter.status = await repository.inspect((source,bytes) => objectUrls.set(source.path,URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}))));
      } catch (error) { adapter.error = error.message; }
      adapter.hasPdf = (url) => repository.hasPdf(url);
      adapter.sourceUrl = (url) => repository.sourceFor(url).url;
      adapter.resolvePdf = (url) => repository.readPdf(url);
      adapter.linkFor = (url) => {
        const source = repository.sourceFor(url), fragment = String(url).includes('#') ? '#'+String(url).split('#')[1] : '';
        return (objectUrls.get(source.path) || source.url)+fragment;
      };
      adapter.rewriteLinks = (root) => {
        root.querySelectorAll('a[href]').forEach((anchor) => {
          if (!anchor.href.startsWith('https://papers.tmua.local/')) return;
          anchor.dataset.localPdf = anchor.href; anchor.href = adapter.linkFor(anchor.href);
        });
      };
      adapter.importFiles = async (files) => {
        if (adapter.importing) return;
        adapter.importing = true;
        window.tmuaDownloadProgress?.({state:'importing',completed:repository.available.size,total:repository.sources.length,message:'Checking and storing the selected PDFs…'});
        try {
          const result = await repository.importFiles(files,(progress) => window.tmuaDownloadProgress?.({...progress,state:'importing',message:`${progress.completed} of ${progress.total} PDFs stored on this device.`}));
          adapter.status = result;
          const message = result.errors.length ? `${result.completed} of ${result.total} PDFs stored. ${result.errors[0]}` : `${result.completed} of ${result.total} PDFs stored. Opening the question bank…`;
          window.tmuaDownloadProgress?.({...result,state:result.accepted > 0 ? 'complete' : result.errors.length ? 'error' : 'idle',message});
        } finally { adapter.importing = false; }
      };
      adapter.openPdf = async (url, popup) => {
        const source = repository.sourceFor(url), fragment = String(url).includes('#') ? '#'+String(url).split('#')[1] : '';
        if (!repository.hasPdf(url)) { popup.location.replace(source.url+fragment); return; }
        let objectUrl = objectUrls.get(source.path);
        if (!objectUrl) { objectUrl = URL.createObjectURL(new Blob([await repository.readPdf(url)],{type:'application/pdf'})); objectUrls.set(source.path,objectUrl); }
        popup.location.replace(objectUrl+fragment);
      };
      // Original publisher pages can be viewed immediately without local imports.
      window.TMUA_CONTENT_READY = true;
      // Reserve the tab during the click so asynchronous local storage does not
      // trigger a popup blocker. The renderer handles already rendered zooms.
      document.addEventListener('click',(event) => {
        const anchor = event.target.closest('a[href]');
        const localPdf = anchor?.dataset.localPdf || (anchor?.href.startsWith('https://papers.tmua.local/') ? anchor.href : '');
        if (!anchor || !localPdf || !repository.hasPdf(localPdf)) return;
        if (anchor.matches('.pdf-region') && !anchor.querySelector('img')?.hidden && anchor.querySelector('img')?.src) return;
        event.preventDefault();
        const popup = window.open('about:blank','_blank');
        if (!popup) { window.alert('Allow this site to open the original PDF in a new tab.'); return; }
        popup.opener = null;
        adapter.openPdf(localPdf,popup).catch((error) => { popup.close(); window.alert(error.message); });
      });
    } catch (error) { adapter.error = error.message; }
  })();
}
