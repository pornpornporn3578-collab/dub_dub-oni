(() => {
  'use strict';
  const plotOptions = {displaylogo: false, responsive: true, scrollZoom: false,
    modeBarButtonsToRemove: ['lasso2d', 'select2d']};
  let figures = window.reportMainFigures || [];
  let plotQueue = Promise.resolve();
  const observer = 'IntersectionObserver' in window
    ? new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        render(entry.target);
      }
    }, {rootMargin: '300px 0px'})
    : null;
  function render(node) {
    if (node.dataset.rendered === '1') return;
    node.dataset.rendered = '1';
    const figure = figures[Number(node.dataset.mainIndex)];
    if (!figure) return;
    node.replaceChildren();
    plotQueue = plotQueue.catch(() => {}).then(() => new Promise(resolve => setTimeout(resolve, 0)))
      .then(() => Plotly.newPlot(node, figure.data, figure.layout, plotOptions))
      .catch(error => {
        const message = document.createElement('div');
        message.className = 'chart-loading';
        message.textContent = '图表绘制失败，请刷新页面重试。';
        node.replaceChildren(message);
        console.error('ENSO chart error:', error);
      });
  }
  const escape = value => String(value ?? '').replace(/[&<>"']/g,
    char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  function dateLabel(value) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.valueOf()) ? String(value || '未知时间') : parsed.toLocaleString('zh-CN', {hour12:false});
  }
  function sectionWithHeading(text) {
    return [...document.querySelectorAll('[data-site-view="enso"]')]
      .find(node => node.querySelector('h2')?.textContent.includes(text));
  }
  function updateSources(snapshot) {
    for (const row of document.querySelectorAll('.sources tbody tr')) {
      const anchor = row.querySelector('a[href]');
      if (!anchor) continue;
      const source = Object.values(snapshot.sources).find(item => item.url === anchor.getAttribute('href'));
      const cells = row.querySelectorAll('td');
      if (source && cells.length >= 4) {
        cells[2].textContent = source.status === 'live' ? '本次联网核对' : '沿用缓存';
        cells[3].textContent = dateLabel(source.fetched_at);
      }
    }
  }
  function updateMethodology() {
    const list = document.querySelector('.method[data-site-view="enso"] ul');
    if (!list) return;
    const lines = [
      'RONI 为 ENSO 主指标，ONI 作传统口径对照。月度、双月度、三月滑动和周度指标发布频率不同；每日运行是核对新发布，不代表每日都有新 ENSO 观测。连续五个重叠季达到 ±0.5℃ 是数值规则，不替代 NOAA 官方咨询。',
      '产区历史气候来自本地已下载的 ECMWF ERA5-Land 小时再分析，基准年份为 2006—2025 年；它是模型结合观测的网格产品，不是某个胶园的实测站记录。地图识别点与行政代理点的覆盖度、可信度和汇总权重在对应看板标注。',
      '温度、土壤湿度和 VPD 按当地时区汇总；降水小时戳代表区间末端，先还原到小时区间再划分当地自然日。任何所需小时缺失时不填成零。完整自然周、滚动窗口及年累计分别要求对应窗口完整，历史分位按图表当前指标与时间口径计算。',
      '深层土壤湿度为 ERA5-Land 第三层（28—100 cm）体积含水量。VPD 根据气温、露点推导；高 VPD 暴露筛查线为 1.8 kPa，仅用于同地历年比较，不能宣称超过即受灾。',
      '最新再分析存在发布延迟；若看板附有预报或衔接估计，会分别标注来源和日期。预报不会混入历史分位基准，再分析补齐后由日更程序优先替换同日期的估计；预测值不称为实测。',
      '割胶评估是当地清晨降雨条件的筛查，不是实测开割天数或产量损失。雨挡、树干湿度、农户作业安排等未纳入，参考产量加权当量也不等于预计减产；判断阈值、窗口及数据完整度请查看割胶天气评估中的方法说明。',
      'ENSO 与官方图集独立于产区气候更新。各来源核验成功后发布本地 JSON／原图；失败保留上次成功快照并标明日期，不改写为今天的新资料。静态托管站点的源站核验需先在电脑运行日更程序，再上传更新后的网页数据与图片。',
      '各国气象局月报和季节展望属于区域背景；有效期结束后仅作历史对照。不能用单个网格点代表全国，也不能将 ENSO 指数直接推成橡胶产量的因果结论。',
      'NASA GIBS VIIRS 红点为卫星热异常，不是经核实的山火数量或过火面积。图像日期按官方时间域选择最近已结束的 UTC 日；云遮挡、过境与处理延迟可能造成漏检，胶园影响仍需 FIRMS 连续日期及地面资料核实。'
    ];
    list.innerHTML = lines.map(line => `<li>${escape(line)}</li>`).join('');
  }
  function updateEnso(snapshot) {
    if (snapshot.schema_version !== 1 || !snapshot.latest?.roni || !Array.isArray(snapshot.figures)) {
      throw new Error('ENSO snapshot format is not supported');
    }
    figures = snapshot.figures;
    const cached = Object.entries(snapshot.sources || {}).filter(([, item]) => item.status === 'cache');
    const hero = document.querySelector('.hero[data-site-view="enso"]');
    if (hero) {
      hero.innerHTML = `<div class="snapshot-alert" id="enso-update-state">ENSO 官方来源核对时间：${escape(dateLabel(snapshot.generated_at))}。${escape(snapshot.note)}</div>
        <h2>一、ENSO 最新概览</h2><p class="brief">${escape(snapshot.conclusion)}</p>
        ${cached.length ? `<div class="warning">以下来源沿用上次缓存：${cached.map(([key, item]) => `${escape(key)}（${escape(dateLabel(item.fetched_at))}）`).join('、')}。不冒充今天的新观测。</div>` : ''}
        <h3>按最新数据自动解读</h3>${snapshot.readings.map(line => `<div class="bullet">${escape(line)}</div>`).join('')}
        <p class="subtle">产区天气请查看“产区气候图”及“割胶天气评估”；本栏不再沿用旧版30个点位的静态文字结论。事件进度为连续5个重叠季达到 ±0.5℃ 的数值规则，不替代 NOAA 官方咨询。</p>`;
    }
    const p = snapshot.progress;
    const latest = snapshot.latest;
    const signed = (value, digits=2) => `${value >= 0 ? '+' : ''}${Number(value).toFixed(digits)}`;
    const kpis = [
      [`RONI · ${latest.roni.season}`, `${signed(latest.roni.value)}℃`, `连续 ${p.run} / 5 季 · ${latest.roni.date.slice(0,7)}`],
      [`ONI · ${latest.oni.season}`, `${signed(latest.oni.value)}℃`, `数据至 ${latest.oni.date.slice(0,7)}`],
      ['周频 Niño 3.4', `${signed(latest.weekly_relative_sst.value)}℃`, `周中心 ${latest.weekly_relative_sst.date}`],
      ['SOI', signed(latest.soi.value,1), `数据至 ${latest.soi.date.slice(0,7)}`],
      ['MEI.v2', signed(latest.mei.value), `数据至 ${latest.mei.date.slice(0,7)}`],
      ['DMI / IOD', `${signed(latest.dmi.value)}℃`, `数据至 ${latest.dmi.date.slice(0,7)}`]
    ];
    const strip = document.querySelector('section.kpis');
    if (strip) strip.innerHTML = kpis.map(([name,value,note]) => `<div class="kpi"><span>${escape(name)}</span><strong>${escape(value)}</strong><small>${escape(note)}</small></div>`).join('');
    const history = sectionWithHeading('ENSO 历史分析');
    const table = history?.querySelector('.table-scroll');
    if (table) table.innerHTML = `<table class="data-table"><thead><tr><th>类型</th><th>起始</th><th>结束</th><th>峰值月</th><th>峰值RONI</th><th>强度</th><th>持续</th></tr></thead><tbody>${snapshot.events.map(event => `<tr><td>${escape(event.type)}</td><td>${escape(event.start)}</td><td>${escape(event.end)}</td><td>${escape(event.peak_date)}</td><td>${signed(event.peak)}</td><td>${escape(event.strength)}</td><td>${event.duration}季</td></tr>`).join('')}</tbody></table>`;
    updateSources(snapshot);
    updateMethodology();
    const meta = document.querySelector('header .meta');
    if (meta) meta.textContent = `ENSO 来源已核对 ${dateLabel(snapshot.generated_at)} · 官方图集显示各来源有效期 · 产区气候与割胶评估显示本地导出日期`;
    for (const node of document.querySelectorAll('[data-main-index]')) {
      const alreadyRendered = node.dataset.rendered === '1';
      node.dataset.rendered = '0';
      if (alreadyRendered) render(node);
    }
    window.dispatchEvent(new CustomEvent('enso:snapshot-ready', {detail: snapshot}));
  }
  async function loadSnapshot() {
    try {
      const response = await fetch(`data/enso.json?v=${Date.now()}`, {cache:'no-store'});
      if (!response.ok) throw new Error(`ENSO HTTP ${response.status}`);
      updateEnso(await response.json());
    } catch (error) {
      const notice = document.querySelector('.hero .snapshot-alert');
      if (notice && !notice.id) notice.textContent = 'ENSO 新快照暂未载入，下面保留2026-09-27旧快照，不是当前日新观测。运行“每日更新气候数据.cmd”后刷新页面重试。';
      console.warn('ENSO snapshot fallback:', error.message);
    }
  }
  window.addEventListener('official:updated', event => {
    if (!event.detail?.key || event.detail.key === 'enso') loadSnapshot();
  });
  updateMethodology();
  loadSnapshot().finally(() => {
    for (const node of document.querySelectorAll('[data-main-index]')) {
      if (observer) observer.observe(node);
      else render(node);
    }
  });
})();
