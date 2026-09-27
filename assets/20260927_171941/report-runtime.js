(() => {
  'use strict';
  const options = {displaylogo:false, responsive:true, scrollZoom:false,
                   modeBarButtonsToRemove:['lasso2d','select2d']};
  const mainFigures = window.reportMainFigures || [];
  const stationFigures = window.reportStationFigures = window.reportStationFigures || Object.create(null);
  const descriptions = JSON.parse(document.getElementById('station-descriptions-data').textContent);
  const stationSelect = document.getElementById('station-select');
  const stationSummary = document.getElementById('station-summary');
  const stationReading = document.getElementById('station-reading');
  const stationLegend = document.getElementById('station-legend');
  const stationNodes = Array.from(document.querySelectorAll('.season-tile'));
  const assetPrefix = document.documentElement.dataset.assetPrefix;
  let selectedId = '';
  let selectionVersion = 0;
  let selectedFigures = null;
  let stationSectionVisible = false;
  let plotQueue = Promise.resolve();
  const inflight = new Map();

  function observer(callback, options) {
    if ('IntersectionObserver' in window) return new IntersectionObserver(callback, options);
    return {observe(node) { callback([{target:node, isIntersecting:true}]); },
            unobserve() {}, disconnect() {}};
  }
  function placeholder(node, message) {
    node.replaceChildren();
    const label = document.createElement('div');
    label.className = 'chart-loading';
    label.textContent = message;
    node.appendChild(label);
  }
  function enqueuePlot(node, figure, version) {
    plotQueue = plotQueue.catch(() => {}).then(() => new Promise(resolve => setTimeout(resolve, 0)))
      .then(() => {
        if (version !== null && version !== selectionVersion) return;
        node.replaceChildren();
        return Plotly.newPlot(node, figure.data, figure.layout, options).catch(error => {
          if (version === null || version === selectionVersion) {
            placeholder(node, '图表绘制失败，请刷新页面重试。');
          }
          console.error('Plotly chart error:', error);
        });
      });
  }

  const mainObserver = observer(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const node = entry.target;
      mainObserver.unobserve(node);
      if (node.dataset.rendered === '1') continue;
      node.dataset.rendered = '1';
      const figure = mainFigures[Number(node.dataset.mainIndex)];
      if (figure) enqueuePlot(node, figure, null);
    }
  }, {rootMargin:'300px 0px'});
  document.querySelectorAll('[data-main-index]').forEach(node => mainObserver.observe(node));

  const stationObserver = observer(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const node = entry.target;
      stationObserver.unobserve(node);
      if (node.dataset.rendered === '1' || !selectedFigures) continue;
      const figure = selectedFigures[Number(node.dataset.stationIndex)];
      if (!figure) continue;
      node.dataset.rendered = '1';
      enqueuePlot(node, figure, selectionVersion);
    }
  }, {rootMargin:'250px 0px'});

  function loadStationScript(id) {
    if (stationFigures[id]) return Promise.resolve(stationFigures[id]);
    if (inflight.has(id)) return inflight.get(id);
    const pending = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = assetPrefix + '/station-' + encodeURIComponent(id) + '.js';
      script.async = true;
      script.onload = () => {
        script.remove();
        if (stationFigures[id]) resolve(stationFigures[id]);
        else reject(new Error('站点图表数据缺失：' + id));
      };
      script.onerror = () => {
        script.remove();
        reject(new Error('无法读取站点图表文件：' + id));
      };
      document.head.appendChild(script);
    });
    inflight.set(id, pending);
    pending.then(() => inflight.delete(id), () => inflight.delete(id));
    return pending;
  }
  function startStationLoad(id, version) {
    loadStationScript(id).then(figures => {
      if (id !== selectedId || version !== selectionVersion) {
        delete stationFigures[id];
        return;
      }
      selectedFigures = figures;
      stationNodes.forEach(node => {
        placeholder(node, '滚动到此处加载季节图…');
        stationObserver.observe(node);
      });
    }).catch(error => {
      if (id === selectedId && version === selectionVersion) {
        stationNodes.forEach(node => placeholder(node, '图表文件未找到，请确认 HTML 旁的 assets 文件夹完整。'));
      }
      console.error(error);
    });
  }
  function showStation(id) {
    const info = descriptions[id];
    if (!info) {
      stationSummary.textContent = '暂无可用站点。';
      return;
    }
    const previousId = selectedId;
    selectedId = id;
    selectionVersion += 1;
    selectedFigures = null;
    stationSummary.textContent = info.name + ' · 实况截至 ' + info.latest + ' · ' +
      info.status +
      (info.signals.length ? ' · 需关注：' + info.signals.join('、') : ' · 当前未触发重点分位规则');
    stationReading.textContent = '本次数据解读：' + info.interpretation;
    stationLegend.replaceChildren();
    const band = document.createElement('span');
    band.className = 'year-key';
    band.textContent = '▰ 历史P25—P75';
    stationLegend.appendChild(band);
    const years = [...new Set([2015, 2016, info.currentYear - 1, info.currentYear])];
    for (const year of years) {
      if (!info.years.includes(year)) continue;
      const item = document.createElement('span');
      item.className = 'year-key key-emphasis';
      const swatch = document.createElement('i');
      swatch.style.borderColor = year === info.currentYear ? '#ff0000' :
        year === info.currentYear-1 ? '#000000' : year === 2015 ? '#8b00ff' :
        '#0000ff';
      item.append(swatch, document.createTextNode(String(year)));
      stationLegend.appendChild(item);
    }
    stationNodes.forEach(node => {
      stationObserver.unobserve(node);
      if (node.data) Plotly.purge(node);
      node.dataset.rendered = '';
      placeholder(node, '正在等待产区图表…');
    });
    if (previousId && previousId !== id) delete stationFigures[previousId];
    if (stationSectionVisible) startStationLoad(id, selectionVersion);
  }

  stationSelect.addEventListener('change', () => showStation(stationSelect.value));
  stationSelect.value = document.documentElement.dataset.defaultStation;
  showStation(stationSelect.value);
  const sectionObserver = observer(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return;
    sectionObserver.disconnect();
    stationSectionVisible = true;
    if (selectedId) startStationLoad(selectedId, selectionVersion);
  }, {rootMargin:'350px 0px'});
  sectionObserver.observe(document.getElementById('station-section'));
})();
