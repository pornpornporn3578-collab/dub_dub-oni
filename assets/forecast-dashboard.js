(() => {
  'use strict';
  const section = document.getElementById('climate-section');
  if (!section) return;
  const panel = document.createElement('section'); panel.className = 'forecast-panel';
  panel.innerHTML = '<div class="forecast-heading"><div><span class="forecast-tag">与历史资料分开</span><h3>ECMWF 短期天气预报</h3></div><select aria-label="预报指标"><option value="rain">降水量</option><option value="t2m_c">平均气温（原生时次均值）</option><option value="soil3">土壤湿度（28–100 cm）</option><option value="VPD_kpa">VPD（原生时次均值）</option></select></div><p class="forecast-status" role="status">正在检查预报归档…</p><div class="forecast-chart"></div><div class="forecast-table-wrap"></div><p class="forecast-note"></p>';
  // Forecasts are supplementary, after every historical/detail/gallery block.
  // Do not let an all-regions gallery put the forecast above the season plots.
  section.append(panel);
  const status = panel.querySelector('.forecast-status'), chart = panel.querySelector('.forecast-chart');
  const selector = panel.querySelector('select'), note = panel.querySelector('.forecast-note');
  let forecast = null, catalog = null, renderToken = 0;
  function selectedId() {
    const scale = document.getElementById('climate-scale')?.value;
    const iso = document.getElementById('climate-country')?.value;
    const region = document.getElementById('climate-region')?.value;
    if (scale === 'region' && region === '__all')
      return document.getElementById('climate-macroregion')?.value || `g_country_${iso}`;
    return region || (scale === 'country' ? `g_country_${iso}` : null);
  }
  function num(value, digits = 1) { return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—'; }
  function bounds(rain) {
    if (!rain?.complete) return '时段 / 样本未完整';
    const low = num(rain.min_mm), high = num(rain.max_mm);
    return `${low}${low !== high ? `–${high}` : ''} mm`;
  }
  async function render() {
    const token = ++renderToken;
    const item = forecast?.entities?.[selectedId()];
    if (!item) {
      status.textContent = forecast ? '当前筛选尚无可用的 ECMWF 预报。历史曲线不受影响。' : '尚未成功下载预报；保留历史图，未用模拟值补齐。请运行每日更新程序。';
      chart.hidden = true; panel.querySelector('.forecast-table-wrap').replaceChildren(); return;
    }
    const rows = item.daily || [], first = rows[0]?.date, last = rows.at(-1)?.date;
    const hist = item.historical_through;
    const gap = hist && first && new Date(`${first}T00:00Z`) - new Date(`${hist}T00:00Z`) > 86400000;
    status.textContent = `${item.name}：历史再分析完整至 ${hist || '未确定'}；预报 ${first || '暂无'}—${last || '暂无'}。${gap ? '两者之间存在未覆盖日期，未补造数据。' : ''} 最新预报起报 ${forecast.latest_run_utc || '未确定'}（UTC）。`;
    note.textContent = `${item.aggregation_basis_label || '气候图固定汇总口径'}。${forecast.meaning || '预报不是实测；历史资料更新后优先显示。'}`;
    const table = document.createElement('table');
    const head = document.createElement('thead'), hr = document.createElement('tr');
    for (const label of ['当地日期 / 来源', '日降水分配界限', '气温时次均值', '28–100 cm 土壤', '预报覆盖']) { const th = document.createElement('th'); th.textContent = label; hr.append(th); }
    head.append(hr); table.append(head); const body = document.createElement('tbody');
    for (const row of rows) {
      const tr = document.createElement('tr');
      for (const value of [`${row.date} · 预报`, bounds(row.rain), `${num(row.t2m_c)} °C`, `${num(row.soil3, 3)} m³/m³ · 有效权重 ${num((row.field_coverage?.soil3 ?? 0) * 100)}%`, `${num((row.sample_coverage ?? 0) * 100)}% 样本 · ${row.rain?.covered_hours ?? '—'}/24h`]) { const td = document.createElement('td'); td.textContent = value; tr.append(td); }
      body.append(tr);
    }
    table.append(body); panel.querySelector('.forecast-table-wrap').replaceChildren(table);
    if (!rows.length || !window.Plotly) { chart.hidden = true; return; }
    chart.hidden = false;
    const metric = selector.value, x = rows.map(r => r.date), units = {rain: 'mm', t2m_c: '°C', soil3: 'm³/m³', VPD_kpa: 'kPa'};
    const traces = metric === 'rain' ? [
      {x, y: rows.map(r => r.rain?.complete ? r.rain.min_mm : null), mode: 'lines', line: {color: '#d39024', width: 1}, name: '日界分配下限'},
      {x, y: rows.map(r => r.rain?.complete ? r.rain.max_mm : null), mode: 'lines+markers', line: {color: '#bc7520', dash: 'dash'}, fill: 'tonexty', fillcolor: 'rgba(211,144,36,.16)', name: '日界分配上限（非概率）'}
    ] : [{x, y: rows.map(r => r[metric]), mode: 'lines+markers', line: {color: '#bc7520', dash: 'dash'}, name: 'ECMWF 预报（原生时次）'}];
    await Plotly.react(chart, traces, {height: 290, margin: {t: 16, l: 62, r: 20, b: 68}, paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: '#fff', yaxis: {title: {text: units[metric]}}, xaxis: {type: 'date'}, legend: {orientation: 'h', y: -.27}, font: {family: 'Arial, Microsoft YaHei', color: '#49554d'}}, {displaylogo: false, responsive: true});
    if (token !== renderToken) return;
  }
  selector.addEventListener('change', () => void render());
  for (const id of ['climate-country', 'climate-scale', 'climate-macroregion', 'climate-region', 'climate-metric'])
    document.getElementById(id)?.addEventListener('change', () => {
      const metric = document.getElementById('climate-metric')?.value;
      const equivalent = {precip: 'rain', tmean: 't2m_c', soil3: 'soil3', vpd: 'VPD_kpa'}[metric];
      if (equivalent) selector.value = equivalent;
      setTimeout(() => void render(), 0);
    });
  const regionSelect = document.getElementById('climate-region');
  if (regionSelect) new MutationObserver(() => void render()).observe(regionSelect, {childList: true});
  Promise.all([fetch('data/forecast.json', {cache: 'no-store'}).then(r => {if (!r.ok) throw Error('no forecast'); return r.json();}), fetch('data/index.json', {cache: 'no-store'}).then(r => r.json())])
    .then(([data, index]) => { forecast = data; catalog = index; window.rubberForecastData = data; window.dispatchEvent(new CustomEvent('rubber-forecast-loaded')); return render(); })
    .catch(() => { status.textContent = '尚未成功下载独立预报归档；历史图正常保留。可运行每日更新程序，预报获取失败不会冒充实测。'; chart.hidden = true; });
})();
