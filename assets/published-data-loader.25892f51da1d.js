/* Lossless transport only: no changes to dates, values or chart logic. */
(() => {
  'use strict';
  const nativeFetch = window.fetch.bind(window);
  const siteRoot = new URL('../', document.currentScript.src);
  const dataRoot = new URL('data/', siteRoot);
  window.fetch = async function(input, init) {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input), location.href);
    const method = String(init?.method || request?.method || 'GET').toUpperCase();
    if (method !== 'GET' || url.origin !== dataRoot.origin ||
        !url.pathname.startsWith(dataRoot.pathname) || !url.pathname.endsWith('.json')) {
      return nativeFetch(input, init);
    }
    if (typeof DecompressionStream !== 'function') {
      throw new Error('请使用新版 Chrome、Edge、Firefox 或 Safari 读取压缩网页数据。');
    }
    url.pathname += '.gz';
    const options = request ? {
      method, headers: request.headers, signal: request.signal,
      credentials: request.credentials, cache: request.cache,
      redirect: request.redirect, ...init
    } : init;
    const response = await nativeFetch(url.href, options);
    if (!response.ok || !response.body) return response;
    const headers = new Headers(response.headers);
    headers.delete('Content-Encoding');
    headers.delete('Content-Length');
    headers.set('Content-Type', 'application/json; charset=utf-8');
    return new Response(response.body.pipeThrough(new DecompressionStream('gzip')), {
      status: response.status, statusText: response.statusText, headers
    });
  };
})();
