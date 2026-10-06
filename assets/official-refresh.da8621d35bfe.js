(() => {
  'use strict';
  const keys = ['enso', 'tmd', 'bmkg', 'vietnam', 'fire', 'iri'];
  const zones = new Map();
  const escape = value => String(value ?? '').replace(/[&<>"']/g,
    char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const localPreview = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
  const style = document.createElement('style');
  style.textContent = `.official-refresh-controls button{font:inherit;font-size:13px;padding:8px 12px;border:1px solid #b5c9d9;border-radius:7px;background:#fff;color:#285677;cursor:pointer}.official-refresh-controls button:hover{background:#eaf3f8}.official-refresh-controls button:focus-visible{outline:2px solid #28648f;outline-offset:3px}.official-refresh-controls button:disabled{opacity:.5;cursor:wait}.official-refresh-state{font-size:12px;max-width:100%;line-height:1.6}`;
  document.head.append(style);
  let busy = false;
  let officialSnapshot = null;
  function dateLabel(value) {
    if (!value) return '未核对';
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? String(value) : date.toLocaleString('zh-CN', {hour12:false});
  }
  function identify(card) {
    const title = card.querySelector('h3')?.textContent || '';
    return title.includes('泰国气象局') ? 'tmd' : title.includes('BMKG') ? 'bmkg' :
      title.includes('越南') ? 'vietnam' : title.includes('卫星热异常') ? 'fire' :
      /IRI|IOD：多模型|CPC 官方 ENSO/.test(title) ? 'iri' : null;
  }
  function reloadImage(img) {
    const source = img.dataset.refreshSource || img.getAttribute('src');
    if (!source) return;
    img.dataset.refreshSource = source;
    const url = new URL(source, location.href);
    url.searchParams.set('_refresh', Date.now());
    img.style.display = '';
    const fallback = img.parentElement?.querySelector('.media-fallback');
    if (fallback) fallback.style.display = 'none';
    img.src = url.href;
  }
  function reloadMedia(container) {
    container.querySelectorAll('img').forEach(reloadImage);
    container.querySelectorAll('iframe').forEach(frame => {
      const source = frame.dataset.refreshSource || frame.getAttribute('src');
      if (!source) return;
      frame.dataset.refreshSource = source;
      const url = new URL(source, location.href);
      url.searchParams.set('_refresh', Date.now());
      frame.src = url.href;
    });
  }
  function controls(card, key, item) {
    const row = document.createElement('div');
    row.className = 'official-refresh-controls';
    row.style.cssText = 'margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center';
    const reread = document.createElement('button');
    reread.type = 'button';
    reread.textContent = card.querySelector('img,iframe') ? '重新读取当前图像' : '重新核对发布页';
    reread.addEventListener('click', () => {
      reloadMedia(card);
      const note = row.querySelector('.official-refresh-state');
      if (note) note.textContent = '已重新读取当前文件；这不代表源站发布了新一期。';
      if (!card.querySelector('img,iframe')) card.querySelector('a[href]')?.click();
    });
    row.append(reread);
    if (key) {
      const latest = document.createElement('button');
      latest.type = 'button';
      latest.textContent = '检查最新一期';
      latest.dataset.officialRefresh = key;
      latest.addEventListener('click', () => requestUpdate(key, row));
      row.append(latest);
    }
    const state = document.createElement('span');
    state.className = 'official-refresh-state subtle';
    state.setAttribute('role','status');
    state.textContent = item?.status === 'check_failed'
      ? `最新核对未成功，保留上次图像；最后核对 ${dateLabel(item.last_check_at)}`
      : item?.verified_at ? `来源核对 ${dateLabel(item.verified_at)}`
      : '此文件为之前存下的快照，尚未重新核对。';
    row.append(state);
    card.append(row);
  }
  function establishZones() {
    for (const key of keys.filter(item => item !== 'enso')) {
      const cards = [...document.querySelectorAll('.official-card')].filter(card => identify(card) === key);
      if (!cards.length) continue;
      const holder = document.createElement('div');
      holder.id = `official-live-${key}`;
      holder.style.display = 'contents';
      cards[0].before(holder);
      for (const card of cards) holder.append(card);
      zones.set(key, holder);
      if (key === 'iri') {
        const heading = holder.parentElement?.previousElementSibling;
        if (heading?.tagName === 'H3' && heading.textContent.includes('IOD 预测')) {
          heading.textContent = 'ENSO / IOD 当期官方预测';
        }
      }
    }
    // Empty old IRI appendix grids should not leave a blank section.
    for (const section of document.querySelectorAll('[data-site-view="enso"]')) {
      if (section.querySelector('h2')?.textContent.includes('附录：IRI') &&
          !section.querySelector('.official-card')) section.remove();
    }
  }
  async function loadOfficial() {
    const response = await fetch(`data/official.json?v=${Date.now()}`, {cache:'no-store'});
    if (!response.ok) throw new Error(`Official HTTP ${response.status}`);
    const snapshot = await response.json();
    if (snapshot.schema_version !== 1) throw new Error('Official schema is not supported');
    officialSnapshot = snapshot;
    updateEnsoCheckState();
    updateOfficialSourceRows(snapshot);
    for (const [key, item] of Object.entries(snapshot.sections || {})) {
      const holder = zones.get(key);
      if (!holder || !Array.isArray(item.cards) || !item.cards.length) continue;
      // HTML is produced locally by fixed-source Python workers, with remote
      // text escaped there. It is not arbitrary fetched upstream page markup.
      holder.innerHTML = item.cards.join('');
      for (const card of holder.querySelectorAll('.official-card')) {
        const today = new Date();
        const localDay = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
        if (item.product_end && item.product_end < localDay) {
          const old = document.createElement('p');
          old.className = 'warning';
          old.textContent = `该产品有效期止于 ${item.product_end}，目前仅作历史对照。`;
          card.querySelector('h3')?.after(old);
        }
        controls(card, key, item);
      }
    }
    return snapshot;
  }
  function updateOfficialSourceRows(snapshot) {
    const tbody = document.querySelector('.method .sources tbody');
    if (!tbody) return;
    tbody.querySelectorAll('[data-official-source]').forEach(row => row.remove());
    for (const row of [...tbody.querySelectorAll('tr')]) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 4) continue;
      const title = cells[0].textContent;
      if (/^(泰国|越南|印度尼西亚) 区域公报|^BMKG：|^越南国家水文气象预报中心：|^泰国气象局最新三个月预测 PDF|^CPC 官方 ENSO 位相概率|^IRI 客观模型 ENSO 位相概率|^IRI 多模型 Niño/.test(title)) {
        row.remove();
      } else if (/有效至|官方原图 \/ 原件|仅有官方文字或入口/.test(cells[2].textContent)) {
        cells[2].textContent = `旧版历史记录（未重新核验） · ${cells[2].textContent.replace(/^旧版历史记录（未重新核验） · /,'')}`;
      }
    }
    const labels = {tmd:'泰国气象局当期原件',bmkg:'印尼 BMKG 当前默认产品',vietnam:'越南最新气候公报',fire:'NASA GIBS 热异常图层',iri:'IRI/CPC 当期预测原图'};
    for (const key of ['tmd','bmkg','vietnam','fire','iri']) {
      const item = snapshot.sections?.[key];
      if (!item?.source_url) continue;
      const row = document.createElement('tr');
      row.dataset.officialSource = key;
      const status = item.status === 'check_failed' ? '本次核对未成功，保留旧资料' :
        item.missing_images?.length ? '已核对新公报；官网配图 404' : '已核对来源';
      row.innerHTML = `<td>${escape(labels[key])} · ${escape(item.product_period || '')}</td><td><a target="_blank" rel="noopener" href="${escape(item.source_url)}">${escape(item.source_url)}</a></td><td>${escape(status)}</td><td>${escape(dateLabel(item.verified_at))}</td>`;
      tbody.append(row);
    }
  }
  async function requestUpdate(key, row) {
    let state = row.querySelector('.official-refresh-state');
    if (busy) {
      state.textContent = '已有官方资料更新正在运行，请稍后重试。';
      return;
    }
    busy = true;
    document.querySelectorAll('[data-official-refresh]').forEach(button => button.disabled = true);
    state.textContent = localPreview
      ? (key === 'enso' ? '正在核对全部 ENSO 曲线及四张 ENSO / IOD 官方预测图，分别保留有效日期…' : '正在核对源站最新发布日期与原件，旧资料会保留到校验成功…')
      : '正在重新读取网站已发布的最新资料…';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 240000);
    try {
      if (!localPreview) {
        await loadOfficial();
        window.dispatchEvent(new CustomEvent('official:updated', {detail:{key}}));
        if (key === 'enso') {
          state = document.querySelector('.hero .official-refresh-state') || state;
          state.textContent = '已重新读取已发布的 ENSO 全部曲线与官方预测图；源站新一期需在电脑运行每日更新并 Push 后发布。';
        } else {
          reloadMedia(zones.get(key) || row.parentElement);
        }
        return;
      }
      const response = await fetch('/api/official-refresh', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({key}), signal:controller.signal, cache:'no-store'
      });
      if (response.status === 404 || response.status === 501 || response.status === 405) {
        state.textContent = '当前预览服务版本不支持源站核对。请关闭旧预览窗口，再双击“打开本地预览.cmd”；也可运行每日更新程序。';
        return;
      }
      const result = await response.json();
      if (!response.ok || result.status === 'busy') {
        state.textContent = result.message || '服务器正在处理其他更新，请稍后重试。';
        return;
      }
      await loadOfficial();
      window.dispatchEvent(new CustomEvent('official:updated', {detail:{key}}));
      if (key === 'enso') {
        const failed = ['enso','iri'].filter(name => result.results?.[name]?.status === 'check_failed');
        const cached = result.results?.enso?.status === 'verified_with_cache';
        state = document.querySelector('.hero .official-refresh-state') || state;
        state.textContent = failed.length
          ? `部分核对未成功（${failed.map(name => name === 'enso' ? '指数与曲线' : 'ENSO / IOD 官方预测图').join('、')}），对应部分保留旧资料；成功部分已更新。`
          : cached ? '曲线与官方预测图已核对，部分指数沿用明确日期的缓存；不代表全部源站实时获取成功。'
          : 'ENSO 全部曲线与四张 ENSO / IOD 官方预测图已核对，发布日期及指标截止日分别见图表。';
      }
    } catch (error) {
      state.textContent = error.name === 'AbortError'
        ? '核对时间较长，服务可能仍在运行；请稍后刷新网页，不要连续重复提交。'
        : '源站核对暂未完成，保留原图。可运行每日更新程序并查看日志。';
    } finally {
      clearTimeout(timer);
      busy = false;
      document.querySelectorAll('[data-official-refresh]').forEach(button => button.disabled = false);
    }
  }
  function addEnsoControls() {
    const hero = document.querySelector('.hero[data-site-view="enso"]');
    if (!hero || hero.querySelector('[data-official-refresh="enso"]')) return;
    const row = document.createElement('div');
    row.className = 'official-refresh-controls';
    row.style.cssText = 'margin-top:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap';
    row.innerHTML = '<button type="button" data-official-refresh="enso">核对最新 ENSO 数据</button><span class="official-refresh-state subtle" role="status">统一核对全部 ENSO 曲线与 ENSO / IOD 官方预测图。</span>';
    row.querySelector('button').addEventListener('click', () => requestUpdate('enso', row));
    hero.append(row);
    updateEnsoCheckState();
  }
  function updateEnsoCheckState() {
    const item = officialSnapshot?.sections?.enso;
    const iri = officialSnapshot?.sections?.iri;
    const state = document.querySelector('.hero [data-official-refresh="enso"]')?.parentElement.querySelector('.official-refresh-state');
    if (!state || !item) return;
    const indices = item.status === 'check_failed'
      ? `ENSO 最近核对未成功（${dateLabel(item.last_check_at)}），保留 ${dateLabel(item.verified_at)} 核验的快照。`
      : `指数与曲线核对 ${dateLabel(item.verified_at)}${item.status === 'verified_with_cache' ? '（部分沿用缓存）' : ''}；有效日期以各指标为准。`;
    const images = iri ? `官方预测图：${iri.product_period || '日期见图'}；${iri.status === 'check_failed' ? '最新核对未成功，保留旧图' : '来源核对 ' + dateLabel(iri.verified_at)}。` : '官方预测图尚未重新核对。';
    state.textContent = `${indices} ${images}${localPreview ? '' : ' 此为静态网站，按钮重读已发布资料；源站核对由每日更新程序执行。'}`;
  }
  establishZones();
  loadOfficial().catch(error => {
    console.warn('Official snapshot fallback:', error.message);
    for (const [key, holder] of zones) for (const card of holder.querySelectorAll('.official-card')) controls(card,key,null);
  }).finally(() => {
    // Other image/text-only source cards get a truthful reread/open action,
    // not a promise that an old monthly outlook has become a new one.
    for (const card of document.querySelectorAll('.official-card')) {
      if (!card.querySelector('.official-refresh-controls')) controls(card, identify(card), null);
    }
  });
  addEnsoControls();
  window.addEventListener('enso:snapshot-ready', addEnsoControls);
  window.addEventListener('site:view-change', () => window.dispatchEvent(new Event('resize')));
})();
