(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const base = new URL('data/', document.baseURI);
  const metricNames = {
    tmean: '平均气温', tmax: '最高气温', precip: '降水量', rain_hours: '降水小时数',
    soil1: '浅层土壤湿度（0–7 cm）', soil2: '土壤湿度（7–28 cm）',
    soil3: '土壤湿度（28–100 cm）', soil4: '深层土壤湿度（100–289 cm）',
    vpd: '水汽压亏缺 VPD', vpd_high_hours: '高 VPD 小时数（>1.8 kPa）'
  };
  const metricUnits = {
    tmean: '°C', tmax: '°C', precip: 'mm', rain_hours: '小时',
    soil1: 'm³/m³', soil2: 'm³/m³', soil3: 'm³/m³', soil4: 'm³/m³', vpd: 'kPa', vpd_high_hours: '小时'
  };
  const modeNames = {
    daily: '日度', weekly: '完整自然周', rolling7: '7 日滚动', rolling15: '15 日滚动', yearly: '全年累计'
  };
  const cumulativeMetrics = new Set(['precip', 'rain_hours', 'vpd_high_hours']);
  // These combinations and colors follow the original station-season plots.
  const metricModes = {
    precip: [['weekly', '完整自然周总量'], ['rolling15', '15 日滚动累计'], ['yearly', '全年累计']],
    rain_hours: [['weekly', '完整自然周总量'], ['rolling15', '15 日滚动累计'], ['yearly', '全年累计']],
    tmean: [['rolling7', '7 日滚动平均']], tmax: [['daily', '日度']],
    soil1: [['daily', '日度']], soil2: [['daily', '日度']], soil3: [['daily', '日度']], soil4: [['daily', '日度']],
    vpd_high_hours: [['rolling15', '15 日滚动累计'], ['yearly', '全年累计']]
  };
  const mutedPalette = ['#b0b7bf', '#d39e40', '#6b91c6', '#5ca988', '#c4775f', '#aaa2bb', '#7fa5c1', '#b99072'];
  const els = {
    section: $('climate-section'), status: $('climate-load-status'), generated: $('climate-generated'),
    country: $('climate-country'), scale: $('climate-scale'), macro: $('climate-macroregion'), search: $('climate-region-search'), region: $('climate-region'),
    metric: $('climate-metric'), mode: $('climate-aggregation'), regionHead: $('climate-region-head'),
    regionTitle: $('climate-region-title'), regionSubtitle: $('climate-region-subtitle'),
    regionType: $('climate-region-type'), quality: $('climate-quality-badge'),
    signals: $('climate-signal-row'), auto: $('climate-auto-reading'), autoText: $('climate-auto-reading-text'),
    chartCard: $('climate-chart-card'), chart: $('climate-chart'),
    chartTitle: $('climate-chart-title'), chartSubtitle: $('climate-chart-subtitle'),
    chartKey: document.querySelector('.climate-chart-key'), chartCaption: $('climate-chart-caption'),
    details: $('climate-detail-grid'), percentile: $('climate-percentile-detail'),
    coverage: $('climate-coverage-detail'), gallerySection: $('climate-gallery-section'), gallery: $('climate-gallery'),
    galleryTitle: $('climate-gallery-title'), gallerySummary: $('climate-gallery-summary'), galleryLegend: $('climate-gallery-legend')
  };
  let catalog = null;
  let selectedRegion = null;
  let selectedSeries = null;
  let selectedToken = 0;
  let chartVersion = 0;
  let timeGalleryVersion = 0;
  let galleryVersion = 0;
  let galleryObserver = null;
  let galleryQueue = Promise.resolve();
  const seriesCache = new Map();
  const seriesInflight = new Map();
  const countryNames = new Map();

  function currentYear() {
    return Number(new Intl.DateTimeFormat('en', {timeZone: 'Asia/Shanghai', year: 'numeric'}).format(new Date()));
  }
  function referenceEnd() {
    return Math.min(Number(catalog?.source?.reference_years?.[1] || 2025), currentYear() - 1);
  }
  function displayName(region) { return region.name || region.name_zh || region.name_original || region.id; }
  function isGroupScale() { return els.scale.value === 'country' || els.scale.value === 'subregion'; }
  function availableModes() {
    const choices = metricModes[els.metric.value] || [['daily', '日度']];
    return isGroupScale() ? [['__all_modes', '全部显示'], ...choices] : choices;
  }
  function populateModes(preferred = els.mode.value) {
    const choices = availableModes();
    els.mode.replaceChildren(...choices.map(([value, label]) => option(value, label)));
    els.mode.value = choices.some(([value]) => value === preferred) ? preferred : choices[0][0];
  }
  function macroGroups(iso3 = els.country.value) {
    return (catalog?.groups || []).filter(group => group.country_iso3 === iso3 && group.type === 'subnational' &&
      !(Array.isArray(group.region_ids) && group.region_ids.length === 0));
  }
  function populateMacroRegions(preferred = '') {
    const groups = macroGroups();
    els.macro.replaceChildren(option('', '全部区域'), ...groups.map(group => option(group.id, displayName(group))));
    if (groups.some(group => group.id === preferred)) els.macro.value = preferred;
    els.macro.disabled = els.scale.value === 'country' || !groups.length;
  }
  function regionReference(region) {
    const record = (tapping?.regions || []).find(item => item.id === region.id);
    return region.reference || record?.reference || {};
  }
  function productionTons(region) {
    const value = region.reference_annual_production_tons ?? region.production_tons ?? regionReference(region).production_tons;
    return value !== null && value !== undefined && Number.isFinite(Number(value)) ? Number(value) : null;
  }
  function sortRegions(regions) {
    return [...regions].sort((a, b) => {
      const av = productionTons(a), bv = productionTons(b);
      if (av !== null || bv !== null) return (bv ?? -1) - (av ?? -1) || displayName(a).localeCompare(displayName(b), 'zh-CN');
      return displayName(a).localeCompare(displayName(b), 'zh-CN');
    });
  }
  function isGallery() { return els.scale.value === 'region' && els.region.value === '__all'; }
  function isPendingDownload(region) {
    return region.coverage?.status === 'pending_download' || region.download_status === 'pending_download' || region.aggregation === 'pending_download' ||
      (!region.series_file && Boolean(region.point_ids?.length || region.selectedpoint_ids?.length || region.selected_point_ids?.length));
  }
  function missingSeriesText(region) {
    return isPendingDownload(region)
      ? '已选定气候格点，2006 年以来的历史下载尚未完成；并非该地区没有气象资料。下载及导出完成后刷新即可绘图。'
      : '此产区尚未确定可用气候格点或尚未导出序列；不会用其他地区的数据代替。';
  }

  function setStatus(message, error = false) {
    els.status.textContent = message;
    els.status.classList.toggle('is-error', error);
  }
  function fmtDate(value) {
    if (!value) return '—';
    const parts = String(value).slice(0, 10).split('-');
    return parts.length === 3 ? `${parts[0]}年${parts[1]}月${parts[2]}日` : String(value);
  }
  function fmtTimestamp(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('zh-CN', {timeZone: 'Asia/Shanghai', year: 'numeric',
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false}).format(date)
      + ' 中国标准时间';
  }
  function fmt(value, metric, mode = 'daily') {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
    const digits = metric.startsWith('soil') ? 3 : metric === 'vpd' ? 2 : 1;
    const unit = metricUnits[metric] || '';
    const suffix = mode === 'yearly' && !cumulativeMetrics.has(metric) ? '年内均值' : '';
    return `${Number(value).toFixed(digits)} ${unit}${suffix ? ` · ${suffix}` : ''}`;
  }
  function option(value, label) {
    const node = document.createElement('option');
    node.value = value;
    node.textContent = label;
    return node;
  }
  function clearSelection(message) {
    ++chartVersion;
    clearTimeGallery();
    selectedSeries = null;
    els.percentile.textContent = '暂无可用序列，无法计算历史同期分位。';
    els.regionHead.hidden = true;
    els.signals.hidden = true;
    els.auto.hidden = true;
    els.chartCard.hidden = true;
    els.details.hidden = true;
    if (els.chart.data && window.Plotly) Plotly.purge(els.chart);
    if (message) setStatus(message);
  }
  function countryRegions(iso3) {
    return (catalog?.regions || []).filter(region => region.country_iso3 === iso3);
  }
  function countryEntities(iso3, scale = els.scale.value) {
    const macro = macroGroups(iso3).find(group => group.id === els.macro.value);
    if (scale === 'region') return sortRegions(countryRegions(iso3).filter(region => !macro ||
      macro.region_ids?.includes(region.id) || region.macroregion_id === macro.id || region.group_ids?.includes(macro.id)));
    const type = scale === 'country' ? 'country' : 'subnational';
    return (catalog?.groups || []).filter(group => group.country_iso3 === iso3 && group.type === type &&
      !(Array.isArray(group.region_ids) && group.region_ids.length === 0) &&
      (type === 'country' || !macro || group.id === macro.id));
  }
  function populateCountries() {
    els.country.replaceChildren();
    for (const country of catalog.countries || []) {
      const iso3 = country.iso3 || country.country_iso3;
      if (!iso3) continue;
      countryNames.set(iso3, country.name || country.name_zh || iso3);
      const regions = countryRegions(iso3);
      els.country.append(option(iso3, `${countryNames.get(iso3)} · ${regions.length} 区`));
    }
    for (const entry of document.getElementById('risk-country')?.options || []) {
      const riskCountry = (tapping?.countries || []).find(item => item.country_iso3 === entry.value);
      if (riskCountry?.label) entry.textContent = riskCountry.label;
      else if (countryNames.has(entry.value)) entry.textContent = countryNames.get(entry.value);
    }
    els.country.disabled = !els.country.options.length;
    els.scale.disabled = !els.country.options.length;
    els.search.disabled = !els.country.options.length;
    const preferred = [...els.country.options].find(entry => entry.value === 'THA') ||
      [...els.country.options].find(entry => countryRegions(entry.value).some(region => region.series_file));
    if (preferred) els.country.value = preferred.value;
    els.scale.value = 'region';
    populateMacroRegions();
    populateModes();
    populateRegions();
  }
  function populateRegions(preferredId = '') {
    els.search.placeholder = els.scale.value === 'region' ? '中文名或原文名' : '搜索国别或大区样本';
    const term = els.search.value.trim().toLocaleLowerCase();
    const regions = countryEntities(els.country.value).filter(region =>
      !term || `${region.name || ''} ${region.name_zh || ''} ${region.name_original || ''} ${region.id || ''}`.toLocaleLowerCase().includes(term));
    els.region.replaceChildren();
    if (els.scale.value === 'region' && regions.length) els.region.append(option('__all', `全部显示 · ${regions.length} 个产区`));
    for (const region of regions) {
      const name = region.name || region.name_zh || region.name_original || region.id;
      const label = `${name}${region.name_original && region.name_zh && !region.name ? ` · ${region.name_original}` : ''}${region.series_file ? '' : isPendingDownload(region) ? '（下载中）' : '（待选点）'}`;
      els.region.append(option(region.id, label));
    }
    els.region.disabled = !regions.length;
    if (els.scale.value === 'region' && regions.length && (!preferredId || preferredId === '__all')) {
      els.region.value = '__all';
      void renderGallery();
      return;
    }
    const preferred = regions.find(region => region.id === preferredId) || regions.find(region => region.series_file) || regions[0];
    if (preferred) {
      els.region.value = preferred.id;
      void selectRegion(preferred.id);
    } else {
      selectedRegion = null;
      clearGallery();
      clearSelection('没有符合搜索条件的地区或样本组。');
    }
  }
  function aggregationLabel(value) {
    return ({representative_point: '代表格点诊断', weighted_diagnostic: '加权诊断',
      equal_weight_diagnostic: '等权诊断', harvest_area_weighted_diagnostic: '已采样地区收割面积加权诊断',
      sampled_regions_equal_diagnostic: '已采样地区等权诊断', pending_download: '已选点 · 历史下载中', no_point: '暂无格点'})[value] || '诊断数据';
  }
  function weightBasisLabel(value) {
    return ({
      reference_annual_production_tons: '参考年产量加权',
      selected_model_cell_rubber_area_share: '模型选中格点橡胶面积份额',
      source_point_weights_or_equal_diagnostic: '来源点位权重；缺失时等权诊断',
      unique_sample_points_equal_weight_not_area: '去重采样格点等权（非面积）',
      no_point: '无格点',
      equal_points_no_source_weight: '无来源权重时格点等权',
      equal_sampled_regions_no_complete_harvest_area: '可割面积不完整，已采样地区等权',
      model_or_polygon_selected_cell_share: '模型或多边形选中格点份额',
      user_workbook_F_harvestable_area_ha_unverified: '工作簿 F 列可割面积（未核验）',
      within_region_weight_from_source_links: '来源关联的产区内格点权重'
    })[value] || (value ? '其他暂定权重口径' : '未注明');
  }
  function qualityText(value) {
    const items = Array.isArray(value) ? value.filter(Boolean) : (typeof value === 'string' ? [value] : []);
    const notes = [];
    for (const item of items) {
      const raw = String(item).trim();
      const englishStart = raw.search(/\s(?=[A-Z][a-z]{2,}(?:\s|-))/);
      const chinese = (englishStart >= 0 ? raw.slice(0, englishStart) : raw).trim();
      if (chinese) notes.push(chinese);
      if (/circa.?2020|2020.*model|2006.*rubber/i.test(raw)) notes.push('胶园图层主要反映约 2020 年的模型分类，不能追溯证明 2006 年胶园位置。');
      if (/under.detect|small positive patch|sparse non.exhaustive/i.test(raw)) notes.push('阳性格点样本可能偏稀疏，不能推算整区胶园面积或产量。');
      if (/large overmap/i.test(raw)) notes.push('来源图层可能高估胶园面积，需要复核。');
      if (/low mapped.rubber|outside strict initial.download area screen/i.test(raw)) notes.push('来源图层的区域覆盖较低，点位代表性需谨慎。');
      if (/2017 admin bounds|older boundary/i.test(raw)) notes.push('行政边界资料版本较旧。');
      if (/not necessarily its centre/i.test(raw)) notes.push('模型阳性多边形可能只与格点相交，不一定包含格点中心。');
      if (/unverified.*workbook|workbook.*unverified/i.test(raw)) notes.push('工作簿中的参考面积尚未独立核验。');
      if (/license not stated|reuse.*rights unconfirmed/i.test(raw)) notes.push('来源图层的再使用许可尚待核实。');
    }
    return [...new Set(notes)].join(' ');
  }
  function showRegionMeta(region, series) {
    const cov = series?.coverage || region.coverage || {};
    const isGroup = region.type === 'country' || region.type === 'subnational';
    const displayName = region.name || region.name_zh || region.name_original || region.id;
    els.regionHead.hidden = false;
    els.regionTitle.textContent = displayName;
    els.regionSubtitle.textContent = isGroup
      ? `${countryNames.get(region.country_iso3) || region.country_iso3} · 已采样地区历史气候诊断 · ${region.type === 'country' ? '国别样本' : '大区样本'}`
      : `${countryNames.get(region.country_iso3) || region.country_iso3} · ${region.name_original || region.id} · ${region.admin_level || '候选产区'}`;
    els.regionType.textContent = isGroup ? '样本范围历史气候' : '产区代表格点历史气候';
    els.quality.textContent = aggregationLabel(region.aggregation);
    els.quality.classList.toggle('is-unavailable', !region.series_file);
    els.quality.classList.toggle('is-provisional', Boolean(region.series_file));
    const pointCount = region.point_ids?.length ?? series?.point_ids?.length ?? 0;
    const coverageText = [
      `完整日期：${fmtDate(cov.first_date)}—${fmtDate(cov.last_complete_date)}。`,
      isGroup ? `已采样候选产区：${region.region_ids?.length ?? series?.region_ids?.length ?? 0} 个；有效完整日：${cov.complete_days ?? '—'}；缺失日：${cov.missing_days ?? '—'}。`
        : `关联气候格点：${pointCount} 个；有效完整日：${cov.complete_days ?? '—'}；缺失日：${cov.missing_days ?? '—'}。`,
      `聚合口径：${aggregationLabel(region.aggregation)}${region.weight_basis ? `（${weightBasisLabel(region.weight_basis)}）` : ''}。`,
      region.weight_coverage != null ? `已采样地区的工作簿参考权重覆盖：${typeof region.weight_coverage === 'number' ? `${Math.round(region.weight_coverage * 100)}%` : region.weight_coverage}；不是胶园地理覆盖率。` : '',
      qualityText(region.quality_warning || series?.quality_warning),
      region.overlaps_region_ids?.length ? `与 ${region.overlaps_region_ids.length} 个目录地区范围重叠，不能将其结果直接相加。` : ''
    ].filter(Boolean).join('\n');
    els.coverage.textContent = coverageText;
  }
  function metricIndex(series, metric) {
    return (series.columns || []).indexOf(metric);
  }
  function rowsByYear(series, metric) {
    const col = metricIndex(series, metric);
    if (col < 0) return new Map();
    const years = new Map();
    for (const row of series.daily || []) {
      const date = row[0];
      if (typeof date !== 'string' || date.length < 10) continue;
      const value = row[col];
      const number = value === null || value === undefined || value === '' ? null : Number(value);
      const year = Number(date.slice(0, 4));
      if (!years.has(year)) years.set(year, []);
      years.get(year).push({date, mmdd: date.slice(5, 10), ordinal: Date.parse(`${date}T00:00:00Z`) / 86400000,
        value: Number.isFinite(number) ? number : null});
    }
    for (const entries of years.values()) entries.sort((a, b) => a.ordinal - b.ordinal);
    return years;
  }
  function transform(entries, metric, mode) {
    if (mode === 'daily') return entries.map(entry => ({...entry}));
    const sumMode = cumulativeMetrics.has(metric);
    if (mode === 'rolling7' || mode === 'rolling15' || mode === 'weekly') {
      const output = [];
      const length = mode === 'rolling15' ? 15 : 7;
      for (let i = 0; i < entries.length; i++) {
        const end = entries[i];
        if (mode === 'weekly' && new Date(end.ordinal * 86400000).getUTCDay() !== 0) continue;
        const window = entries.slice(Math.max(0, i - length + 1), i + 1);
        const complete = window.length === length && window.every((entry, j) => entry.value !== null &&
          (j === 0 || entry.ordinal - window[j - 1].ordinal === 1));
        output.push({...end, value: complete ? window.reduce((total, entry) => total + entry.value, 0) / (sumMode ? 1 : length) : null});
      }
      return output;
    }
    let total = 0;
    let count = 0;
    let invalid = entries[0]?.mmdd !== '01-01';
    let previous = null;
    return entries.map(entry => {
      if (previous !== null && entry.ordinal - previous !== 1) invalid = true;
      if (entry.value === null) invalid = true;
      previous = entry.ordinal;
      if (!invalid) { total += entry.value; count += 1; }
      return {...entry, value: invalid ? null : total / (sumMode ? 1 : count)};
    });
  }
  function quantile(values, p) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const n = (sorted.length - 1) * p;
    const low = Math.floor(n);
    return sorted[low] + (sorted[Math.ceil(n)] - sorted[low]) * (n - low);
  }
  function seasonBand(series, metric, mode, transformed, years) {
    if (mode === 'weekly') return null;
    const labels = [...new Set([...transformed.values()].flat().map(entry => entry.mmdd))].sort();
    const refEnd = referenceEnd();
    const byDay = new Map();
    for (const year of years) {
      if (year > refEnd) continue;
      for (const entry of transformed.get(year) || []) {
        if (entry.value === null) continue;
        if (!byDay.has(entry.mmdd)) byDay.set(entry.mmdd, []);
        byDay.get(entry.mmdd).push(entry.value);
      }
    }
    return {labels, p25: labels.map(key => byDay.get(key)?.length >= 5 ? quantile(byDay.get(key), .25) : null),
      p75: labels.map(key => byDay.get(key)?.length >= 5 ? quantile(byDay.get(key), .75) : null)};
  }
  function latestValid(entries) {
    for (let i = entries.length - 1; i >= 0; i--) if (entries[i].value !== null) return entries[i];
    return null;
  }
  function isoWeek(date) {
    const day = new Date(`${date}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7));
    const start = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
    return Math.ceil((((day - start) / 86400000) + 1) / 7);
  }
  function percentileContext(series, metric, mode, transformed, years, latest) {
    if (!latest) return {label: '暂无完整数据', note: '当前序列无有效观测。'};
    let values = [];
    let basis = '';
    const refEnd = referenceEnd();
    for (const year of years) {
      if (year > refEnd) continue;
      const entries = transformed.get(year) || [];
      const targetOrdinal = Date.parse(`2000-${latest.mmdd}T00:00:00Z`) / 86400000;
      const matches = entries.filter(entry => entry.value !== null && (mode === 'weekly'
        ? Math.abs(Date.parse(`2000-${entry.mmdd}T00:00:00Z`) / 86400000 - targetOrdinal) <= 3
        : entry.mmdd === latest.mmdd));
      if (matches.length) values.push(matches.reduce((sum, entry) => sum + entry.value, 0) / matches.length);
    }
    basis = mode === 'weekly' ? '相同月日前后 3 天的完整自然周' : '相同月日';
    if (values.length < 5) return {label: '历史样本不足', note: `${basis}只有 ${values.length} 年有效汇总值。`};
    const rank = Math.round(100 * (values.filter(value => value < latest.value).length +
      .5 * values.filter(value => value === latest.value).length) / values.length);
    return {label: `约 P${rank}`, rank, sample: values.length,
      note: `${basis}的 ${values.length} 年有效${modeNames[mode]}值比较；P25 ${fmt(quantile(values, .25), metric)}，P75 ${fmt(quantile(values, .75), metric)}。`};
  }
  function dailyRowLookup(series) {
    const rows = new Map();
    for (const row of series.daily || []) {
      // Duplicate days are not seven independent complete days.
      if (rows.has(row[0])) rows.set(row[0], null);
      else rows.set(row[0], row);
    }
    return rows;
  }
  function sevenDayWindow(series, metric, endDate, rows = dailyRowLookup(series)) {
    const index = metricIndex(series, metric);
    const end = Date.parse(`${endDate}T00:00:00Z`);
    if (index < 0 || !Number.isFinite(end) || new Date(end).toISOString().slice(0, 10) !== endDate) return null;
    const hoursIndex = metricIndex(series, 'hours'), expectedIndex = metricIndex(series, 'expected_hours');
    const values = [];
    for (let offset = 6; offset >= 0; offset--) {
      const day = new Date(end - offset * 86400000).toISOString().slice(0, 10);
      const row = rows.get(day);
      if (!row || row[index] === null || row[index] === undefined || row[index] === '' || !Number.isFinite(Number(row[index]))) return null;
      if (hoursIndex >= 0 && expectedIndex >= 0 &&
        (!(Number(row[expectedIndex]) > 0) || Number(row[hoursIndex]) !== Number(row[expectedIndex]))) return null;
      values.push(Number(row[index]));
    }
    const total = values.reduce((sum, value) => sum + value, 0);
    return {date: endDate, mmdd: endDate.slice(5), startDate: new Date(end - 6 * 86400000).toISOString().slice(0, 10),
      value: total / (cumulativeMetrics.has(metric) ? 1 : 7)};
  }
  function sevenDayComparison(series, metric, endDate = series.coverage?.last_complete_date, rows = dailyRowLookup(series)) {
    const latest = sevenDayWindow(series, metric, endDate, rows);
    const endingYear = Number(String(endDate).slice(0, 4));
    // Exclude the window's own year too when an older snapshot is displayed.
    const referenceFirst = 2006, referenceLast = Math.min(currentYear() - 1, endingYear - 1);
    const values = [];
    if (Number.isFinite(endingYear)) {
      for (let year = referenceFirst; year <= referenceLast; year++) {
        const window = sevenDayWindow(series, metric, `${year}-${String(endDate).slice(5)}`, rows);
        if (window) values.push(window.value);
      }
    }
    const rank = latest && values.length >= 5
      ? Math.round(100 * (values.filter(value => value < latest.value).length +
        .5 * values.filter(value => value === latest.value).length) / values.length) : null;
    return {latest, sample: values.length, referenceFirst, referenceLast, rank,
      median: values.length >= 5 ? quantile(values, .5) : null};
  }
  function signalsFor(series) {
    const lastDate = series.coverage?.last_complete_date;
    const rows = dailyRowLookup(series);
    const defs = [
      ['近 7 日降雨', 'precip', 'mm'],
      ['近 7 日平均最高温', 'tmax', '°C'],
      ['近 7 日平均浅层土壤湿度', 'soil1', 'm³/m³'],
      ['近 7 日平均 VPD', 'vpd', 'kPa']
    ];
    els.signals.replaceChildren();
    for (const [label, metric, unit] of defs) {
      const comparison = sevenDayComparison(series, metric, lastDate, rows);
      const latest = comparison.latest;
      const card = document.createElement('div');
      card.className = 'climate-signal';
      const heading = document.createElement('span'); heading.textContent = label;
      const value = document.createElement('strong'); value.textContent = latest ? `${latest.value.toFixed(metric === 'soil1' ? 3 : metric === 'vpd' ? 2 : 1)} ${unit}` : '—';
      const percentile = document.createElement('span'); percentile.className = 'climate-signal-percentile';
      percentile.textContent = comparison.rank !== null ? `历史同期约 P${comparison.rank} · ${comparison.sample} 个有效历史年份`
        : `${latest ? '历史样本不足' : '当前窗口不完整'} · ${comparison.sample} 个有效历史年份`;
      percentile.title = `基准 ${comparison.referenceFirst}–${comparison.referenceLast}；每年相同月日截至的连续 7 日${metric === 'precip' ? '累计降雨' : '平均值'}。有效历史窗口不足 5 年时不计算分位。`;
      const note = document.createElement('small'); note.textContent = `${fmtDate(lastDate)}止 · ${latest ? '7 个完整日' : '数据不足，不向前寻找替代窗口'}`;
      card.append(heading, value, percentile, note);
      els.signals.append(card);
    }
    els.signals.hidden = false;
  }
  function rollingComparison(series, metric) {
    const comparison = sevenDayComparison(series, metric);
    return comparison.latest ? comparison : null;
  }
  function matchingRiskRecord() {
    if (!tapping || !selectedRegion) return null;
    if (selectedRegion.type === 'country')
      return (tapping.countries || []).find(item => item.group_id === selectedRegion.id ||
        item.country_iso3 === selectedRegion.country_iso3);
    if (selectedRegion.type === 'subnational')
      return (tapping.groups || []).find(item => item.group_id === selectedRegion.id);
    return (tapping.regions || []).find(item => item.id === selectedRegion.id);
  }
  function renderAutoReading() {
    if (!selectedSeries || !selectedRegion) { els.auto.hidden = true; return; }
    const cov = selectedSeries.coverage || {};
    const rain = rollingComparison(selectedSeries, 'precip');
    const temp = rollingComparison(selectedSeries, 'tmean');
    const parts = [`完整气候日截至 ${fmtDate(cov.last_complete_date)}；以下均为 ERA5-Land 历史再分析，非实时观测或天气预报。`];
    parts.push(rain && rain.rank !== null
      ? `近 7 日累计降水 ${fmt(rain.latest.value, 'precip')}，在 ${rain.sample} 年相同月日的 7 日窗口中约处 P${rain.rank}。`
      : '近 7 日降水历史比较所需的连续日或同期样本不足。');
    parts.push(temp && temp.median !== null
      ? `近 7 日平均气温 ${fmt(temp.latest.value, 'tmean')}，比历史同期中位数${temp.latest.value >= temp.median ? '高' : '低'} ${Math.abs(temp.latest.value - temp.median).toFixed(1)} °C。`
      : '近 7 日气温历史比较所需的连续日或同期样本不足。');
    const riskRecord = matchingRiskRecord();
    const riskDay = latestDay(riskRecord);
    if (riskDay) {
      parts.push(`历史天气不利条件等级：${riskLevel(riskDay.risk_level)[0]}（${fmtDate(riskDay.date)}，不利条件占比 ${pct(riskDay.adverse_share)}）；并非实际停割，详见“割胶天气评估”栏目。`);
      if (selectedRegion.weight_basis && riskDay.weight_basis && selectedRegion.weight_basis !== riskDay.weight_basis)
        parts.push('本页气候曲线与割胶不利条件使用不同的样本权重口径，数值不能直接相减或视作同一国别覆盖率。');
    } else {
      parts.push('割胶不利天气等级尚未导出或此范围没有可匹配的结果。');
    }
    parts.push(cov.missing_days > 0
      ? `覆盖警示：全序列有 ${cov.missing_days} 个不完整日，异常时期请逐项核对小时覆盖与现场天气。`
      : '覆盖提示：异常时期仍需核对小时覆盖、现场天气和后续预报。');
    els.autoText.textContent = parts.join('\n');
    els.auto.hidden = false;
  }
  function transformedYears(rawYears, metric, mode) {
    return new Map([...rawYears].map(([year, entries]) => {
      const needsPrevious = mode === 'rolling7' || mode === 'rolling15' || mode === 'weekly';
      const previous = needsPrevious ? (rawYears.get(year - 1) || []).slice(-14) : [];
      return [year, transform([...previous, ...entries], metric, mode).filter(entry => Number(entry.date.slice(0, 4)) === year)];
    }));
  }
  function measureLabel(metric, mode) {
    return mode === 'yearly' ? '全年累计' : mode === 'daily' ? '日度' :
      mode === 'weekly' ? '完整自然周总量' : `${modeNames[mode]}${cumulativeMetrics.has(metric) ? '累计' : '平均'}`;
  }
  function figureFor(series, metric, mode) {
    const rawYears = rowsByYear(series, metric);
    const years = [...rawYears.keys()].sort((a, b) => a - b);
    if (!years.length) return null;
    const current = currentYear();
    const previous = current - 1;
    const transformed = transformedYears(rawYears, metric, mode);
    const latest = latestValid(transformed.get(current) || []);
    const band = seasonBand(series, metric, mode, transformed, years);
    const context = percentileContext(series, metric, mode, transformed, years, latest);
    const traces = [];
    if (band?.p25.some(value => value !== null) && band?.p75.some(value => value !== null)) {
      const x = band.labels.map(day => `2000-${day}`);
      traces.push({type: 'scatter', mode: 'lines', x, y: band.p75, line: {width: 0},
        hoverinfo: 'skip', showlegend: false});
      traces.push({type: 'scatter', mode: 'lines', x, y: band.p25, fill: 'tonexty',
        fillcolor: 'rgba(125,130,138,.26)', line: {width: 0}, name: '历史 P25—P75', showlegend: false, hoverinfo: 'skip'});
    }
    const highlighted = new Set([2015, 2016, previous, current]);
    for (const year of years.filter(value => value >= 2015 && value <= current && !highlighted.has(value))) {
      const entries = transformed.get(year);
      traces.push({type: 'scatter', mode: 'lines', x: entries.map(entry => `2000-${entry.mmdd}`),
        y: entries.map(entry => entry.value), name: String(year), showlegend: false,
        opacity: .58, line: {color: mutedPalette[((year - 2017) % mutedPalette.length + mutedPalette.length) % mutedPalette.length], width: 1.2},
        hovertemplate: `${year} %{x|%m-%d}<br>%{y:.2f} ${metricUnits[metric]}<extra></extra>`});
    }
    const emphasis = [[2015, '#8B00FF', 'circle', '#E6D7FF', '#9900FF'],
      [2016, '#0000FF', 'circle', '#DAE3F3', '#0000FF'],
      [previous, '#000000', 'circle', '#E7E6E6', '#000000'],
      [current, '#FF0000', 'square', '#FFF2CC', '#ED7D31']];
    for (const [year, color, symbol, fill, border] of emphasis) {
      const entries = transformed.get(year);
      if (!entries || traces.some(trace => trace.name === String(year))) continue;
      traces.push({type: 'scatter', mode: 'lines+markers', x: entries.map(entry => `2000-${entry.mmdd}`),
        y: entries.map(entry => entry.value), name: String(year), showlegend: false,
        line: {color, width: year === current ? 3 : 2.35},
        marker: {symbol, size: mode === 'weekly' ? 6 : 4.2, color: fill, line: {color: border, width: 1.25}},
        hovertemplate: `${year} %{x|%m-%d}<br>%{y:.2f} ${metricUnits[metric]}<extra></extra>`});
    }
    const title = `${metricNames[metric]}：${measureLabel(metric, mode)}`;
    const layout = {
      title: {text: `${title}<br><sup>当前历史分位点：${context.rank ?? '样本不足'}${context.rank != null ? '%' : ''} · 截至 ${latest?.mmdd || '—'} · 历史样本 ${context.sample ?? 0} 年</sup>`,
        x: .02, xanchor: 'left', font: {size: 16}},
      height: 355, autosize: true, margin: {l: 50, r: 15, t: 70, b: 42},
      paper_bgcolor: '#fff', plot_bgcolor: '#fff', hovermode: 'x unified',
      font: {family: 'Arial, Microsoft YaHei, sans-serif', color: '#20262e', size: 11}, showlegend: false,
      xaxis: {type: 'date', range: ['2000-01-01', '2000-12-31'], tickformat: '%m月', dtick: 'M2',
        showgrid: false, linecolor: '#cbd3d9', rangeslider: {visible: false}},
      yaxis: {title: {text: metricUnits[metric]}, gridcolor: '#edf0f2', rangemode: cumulativeMetrics.has(metric) ? 'tozero' : 'normal'}
    };
    return {traces, layout, context, latest, title, current, previous};
  }
  const plotOptions = {displaylogo: false, responsive: true, scrollZoom: false, modeBarButtonsToRemove: ['lasso2d', 'select2d']};
  function chartCaptionFor(mode) {
    return mode === 'weekly'
      ? '完整自然周仅在周日绘点；相同月日前后 3 天内的历年完整周作分位比较，不绘周度分位带。'
      : `灰带按 2006–${referenceEnd()} 年相同月日的有效${modeNames[mode]}值计算 P25—P75；其他年份沿用原版八色细线。`;
  }
  function ensureTimeGallery() {
    if (els.timeGallerySection) return;
    const section = document.createElement('div'); section.id = 'climate-time-gallery-section';
    section.className = 'climate-gallery-section climate-time-gallery-section'; section.hidden = true;
    const heading = document.createElement('div'); heading.className = 'climate-gallery-heading';
    const text = document.createElement('div');
    const title = document.createElement('h3'); title.id = 'climate-time-gallery-title';
    const summary = document.createElement('p'); summary.id = 'climate-time-gallery-summary';
    text.append(title, summary);
    const legend = document.createElement('div'); legend.id = 'climate-time-gallery-legend';
    legend.className = 'climate-gallery-legend'; legend.setAttribute('aria-label', '季节图线条说明');
    heading.append(text, legend);
    const grid = document.createElement('div'); grid.id = 'climate-time-gallery';
    grid.className = 'climate-gallery climate-time-gallery'; grid.setAttribute('aria-live', 'polite');
    section.append(heading, grid); els.chartCard.after(section);
    Object.assign(els, {timeGallerySection: section, timeGallery: grid, timeGalleryTitle: title,
      timeGallerySummary: summary, timeGalleryLegend: legend});
  }
  function clearTimeGallery() {
    ++timeGalleryVersion;
    if (!els.timeGallerySection) return;
    for (const plot of els.timeGallery.querySelectorAll('.climate-gallery-chart'))
      if (plot.data && window.Plotly) Plotly.purge(plot);
    els.timeGallery.replaceChildren(); els.timeGallerySection.hidden = true;
  }
  async function renderTimeGallery() {
    ensureTimeGallery();
    const version = timeGalleryVersion, metric = els.metric.value;
    const series = selectedSeries, region = selectedRegion;
    const choices = metricModes[metric] || [['daily', '日度']];
    els.chartCard.hidden = true;
    if (els.chart.data && window.Plotly) Plotly.purge(els.chart);
    els.timeGalleryTitle.textContent = `${displayName(region)} · ${metricNames[metric]} · 全部时间口径`;
    els.timeGallerySummary.textContent = `同时展示 ${choices.length} 种既有口径，使用相同的汇总序列与原季节图配色；数据至 ${fmtDate(series.coverage?.last_complete_date)}。`;
    renderSeasonLegend(els.timeGalleryLegend); els.timeGallerySection.hidden = false;
    els.percentile.textContent = '每张季节图分别标示本口径的历史同期位置；上方近 7 日卡片始终使用独立的同口径 7 日历史窗口。';
    els.details.hidden = false;
    let rendered = 0;
    for (const [mode, label] of choices) {
      if (version !== timeGalleryVersion || els.section.hidden) return;
      const card = document.createElement('article'); card.className = 'climate-gallery-card climate-time-gallery-card'; card.dataset.mode = mode;
      const title = document.createElement('h4'); title.textContent = `${metricNames[metric]} · ${label}`;
      const plot = document.createElement('div'); plot.className = 'climate-gallery-chart';
      plot.setAttribute('aria-label', `${displayName(region)} ${metricNames[metric]} ${label}季节图`);
      const reading = document.createElement('p'); reading.className = 'climate-gallery-reading';
      const caption = document.createElement('p'); caption.className = 'climate-chart-caption'; caption.textContent = chartCaptionFor(mode);
      card.append(title, plot, reading, caption); els.timeGallery.append(card);
      try {
        const figure = figureFor(series, metric, mode);
        if (!figure || !window.Plotly) throw new Error('所选口径暂无有效数据或图表库未加载');
        await Plotly.newPlot(plot, figure.traces, figure.layout, plotOptions);
        if (version !== timeGalleryVersion || !card.isConnected) { Plotly.purge(plot); return; }
        reading.textContent = figure.latest
          ? `${fmtDate(figure.latest.date)}：${fmt(figure.latest.value, metric, mode)} · 历史位置 ${figure.context.label}`
          : `历史序列截至 ${fmtDate(series.coverage?.last_complete_date)}；尚无 ${currentYear()} 年此口径的完整值。`;
        reading.title = figure.context.note; rendered++;
      } catch (error) {
        if (version !== timeGalleryVersion || !card.isConnected) return;
        plot.textContent = `图表暂未显示：${error.message}。`; plot.classList.add('is-empty');
      }
    }
    if (version === timeGalleryVersion)
      setStatus(`已显示 ${displayName(region)} 的 ${metricNames[metric]} · ${rendered}/${choices.length} 种时间口径。`, rendered === 0);
  }
  async function loadSeries(region) {
    if (!region.series_file) throw new Error('尚未导出此地区的气候序列');
    const key = region.series_file;
    if (seriesCache.has(key)) {
      const value = seriesCache.get(key); seriesCache.delete(key); seriesCache.set(key, value); return value;
    }
    if (seriesInflight.has(key)) return seriesInflight.get(key);
    const request = (async () => {
      const response = await fetch(new URL(key.replace(/^\/+/, ''), base), {cache: 'no-store'});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const series = await response.json();
      if (series.schema_version !== 1 || !Array.isArray(series.daily) || !Array.isArray(series.columns))
        throw new Error('地区序列格式不符合 schema v1');
      seriesCache.set(key, series);
      while (seriesCache.size > 6) seriesCache.delete(seriesCache.keys().next().value);
      return series;
    })();
    seriesInflight.set(key, request);
    try { return await request; } finally { seriesInflight.delete(key); }
  }
  function clearGallery() {
    ++galleryVersion;
    galleryObserver?.disconnect();
    for (const node of els.gallery.querySelectorAll('.climate-gallery-chart')) if (node.data && window.Plotly) Plotly.purge(node);
    els.gallery.replaceChildren();
    els.gallerySection.hidden = true;
  }
  function productionCaption(region, scopeRegions) {
    const tons = productionTons(region);
    if (tons === null) return '暂无参考产量 · 产量未公布地区按名称排序';
    const year = region.production_reference_year || regionReference(region).year;
    const countryTotal = countryRegions(region.country_iso3).reduce((sum, item) => sum + (productionTons(item) ?? 0), 0);
    const groupTotal = scopeRegions.reduce((sum, item) => sum + (productionTons(item) ?? 0), 0);
    const countryShare = region.production_share_country ?? (countryTotal > 0 ? tons / countryTotal : null);
    const groupShare = region.production_share_group ?? (groupTotal > 0 ? tons / groupTotal : null);
    const countryBasis = region.production_share_basis === 'Hainan_reference_total' ||
      regionReference(region).production_share_basis === 'Hainan_reference_total'
      ? '海南参考产量占比' : '国别参考产量占比';
    return [`${year || '参考年'}产量 ${(tons / 10000).toFixed(2)} 万吨`,
      countryShare !== null ? `${countryBasis} ${(countryShare * 100).toFixed(2)}%` : '',
      els.macro.value && groupShare !== null ? `本区域占比 ${(groupShare * 100).toFixed(2)}%` : ''].filter(Boolean).join(' · ');
  }
  function renderSeasonLegend(container = els.galleryLegend) {
    const year = currentYear();
    const keys = [['历史 P25—P75', 'rgba(125,130,138,.26)', 'band'],
      [`${year} · 今年`, '#FF0000'], [`${year - 1} · 去年`, '#000000'], ['2016', '#0000FF'], ['2015', '#8B00FF']];
    container.replaceChildren();
    for (const [label, color, style] of keys) {
      const key = document.createElement('span'), swatch = document.createElement('i');
      swatch.style.setProperty('--key-color', color); if (style) swatch.className = style;
      key.append(swatch, document.createTextNode(label)); container.append(key);
    }
  }
  async function drawGalleryCard(card, region, version, metric, mode) {
    if (version !== galleryVersion || els.section.hidden) return;
    const plot = card.querySelector('.climate-gallery-chart'), reading = card.querySelector('.climate-gallery-reading');
    if (!region.series_file) {
      plot.textContent = missingSeriesText(region);
      reading.textContent = isPendingDownload(region) ? '历史下载中 · 完成后请重新导出并刷新页面' : '点位来源待补齐 · 暂不绘制';
      plot.classList.add('is-empty'); return;
    }
    plot.textContent = '正在读取本地气候序列…';
    try {
      const series = await loadSeries(region);
      if (version !== galleryVersion || !card.isConnected || els.section.hidden) return;
      const figure = figureFor(series, metric, mode);
      if (!figure || !figure.traces.some(trace => trace.y?.some(value => value !== null)))
        throw new Error(`序列中没有 ${metricNames[metric]} 的有效值`);
      plot.replaceChildren();
      await Plotly.newPlot(plot, figure.traces, figure.layout, plotOptions);
      if (version !== galleryVersion || !card.isConnected) { Plotly.purge(plot); return; }
      reading.textContent = figure.latest
        ? `${fmtDate(figure.latest.date)}：${fmt(figure.latest.value, metric, mode)} · 历史位置 ${figure.context.label}`
        : `历史序列截至 ${fmtDate(series.coverage?.last_complete_date)}；尚无 ${currentYear()} 年此指标完整值。`;
      reading.title = figure.context.note;
    } catch (error) {
      if (version !== galleryVersion || !card.isConnected) return;
      plot.textContent = `图表暂未显示：${error.message}。`; plot.classList.add('is-empty');
      reading.textContent = '请核对当地序列导出状态及所选指标。';
    }
  }
  async function renderGallery() {
    if (!catalog || !isGallery()) return;
    ++selectedToken; selectedRegion = null; selectedSeries = null;
    clearSelection(); clearGallery();
    if (els.section.hidden) { setStatus('目录已就绪。打开“产区气候图”后加载当前区域的全部季节图。'); return; }
    const version = galleryVersion, metric = els.metric.value, mode = els.mode.value;
    const term = els.search.value.trim().toLocaleLowerCase();
    const scopeRegions = countryEntities(els.country.value, 'region');
    const regions = scopeRegions.filter(region => !term ||
      `${displayName(region)} ${region.name_original || ''} ${region.id}`.toLocaleLowerCase().includes(term));
    const macro = macroGroups().find(group => group.id === els.macro.value);
    const available = regions.filter(region => region.series_file).length;
    const pending = regions.filter(isPendingDownload).length;
    const productionCount = regions.filter(region => productionTons(region) !== null).length;
    els.galleryTitle.textContent = `${macro ? displayName(macro) : countryNames.get(els.country.value)} · ${metricNames[metric]} · ${measureLabel(metric, mode)}`;
    els.gallerySummary.textContent = `共 ${regions.length} 个候选产区，${available} 个已导出序列${pending ? `，${pending} 个已选点、历史下载待完成` : ''}。${productionCount
      ? ` ${productionCount} 个有工作簿参考产量，按产量占比从高到低排列；其余列在后方。`
      : ' 尚无可比较的完整参考产量，暂按产区名称排列。'}`;
    renderSeasonLegend(); els.gallerySection.hidden = false;
    galleryObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        galleryObserver.unobserve(entry.target);
        const region = regions.find(item => item.id === entry.target.dataset.regionId);
        if (!region) continue;
        galleryQueue = galleryQueue.catch(() => {}).then(() => drawGalleryCard(entry.target, region, version, metric, mode));
      }
    }, {rootMargin: '350px 0px'}) : null;
    for (const [index, region] of regions.entries()) {
      const card = document.createElement('article'); card.className = 'climate-gallery-card'; card.dataset.regionId = region.id;
      const head = document.createElement('div'); head.className = 'climate-gallery-card-head';
      const name = document.createElement('button'); name.className = 'climate-gallery-name'; name.type = 'button';
      name.textContent = `${index + 1}. ${displayName(region)}`;
      name.addEventListener('click', () => { els.region.value = region.id; void selectRegion(region.id); });
      const quality = document.createElement('span'); quality.className = 'climate-gallery-point';
      quality.textContent = `${region.point_ids?.length ?? 0} 个格点`;
      head.append(name, quality);
      const production = document.createElement('p'); production.className = 'climate-gallery-production';
      production.textContent = productionCaption(region, scopeRegions);
      const plot = document.createElement('div'); plot.className = 'climate-gallery-chart';
      plot.textContent = '滚动到此处加载季节图…'; plot.setAttribute('aria-label', `${displayName(region)} ${metricNames[metric]}季节图`);
      const reading = document.createElement('p'); reading.className = 'climate-gallery-reading';
      reading.textContent = `当地日期 · ${aggregationLabel(region.aggregation)} · ${region.timezone || '按当地时区'}`;
      card.append(head, production, plot, reading); els.gallery.append(card);
      if (galleryObserver) galleryObserver.observe(card);
      else galleryQueue = galleryQueue.catch(() => {}).then(() => drawGalleryCard(card, region, version, metric, mode));
    }
    setStatus(`已列出 ${regions.length} 个产区，图表按页面可见范围加载。`);
  }
  async function renderChart() {
    if (isGallery()) { void renderGallery(); return; }
    clearTimeGallery();
    if (!selectedSeries || els.section.hidden) return;
    const version = ++chartVersion;
    const metric = els.metric.value, mode = els.mode.value;
    if (isGroupScale() && mode === '__all_modes') { await renderTimeGallery(); return; }
    const figure = figureFor(selectedSeries, metric, mode);
    if (!figure || !window.Plotly) { els.chartCard.hidden = true; setStatus('所选指标暂无有效数据或图表库未加载。', true); return; }
    els.chartTitle.textContent = figure.title;
    els.chartSubtitle.textContent = `${displayName(selectedRegion)} · 以每年相同月日对齐 · 数据至 ${fmtDate(selectedSeries.coverage?.last_complete_date)}`;
    els.chartKey.textContent = `${figure.current}（今年）红线 · ${figure.previous}（去年）黑线 · 2016 蓝线 · 2015 紫线`;
    els.chartCaption.textContent = chartCaptionFor(mode);
    els.chartCard.hidden = false;
    try {
      await Plotly.react(els.chart, figure.traces, figure.layout, plotOptions);
      if (version !== chartVersion) return;
      const {context, latest} = figure;
      els.percentile.textContent = latest
        ? `${fmtDate(latest.date)}：${fmt(latest.value, metric, mode)}；历史位置 ${context.label}。\n${context.note}`
        : context.note;
      els.details.hidden = false;
      setStatus(`已显示 ${selectedRegion.name || selectedRegion.name_zh || selectedRegion.name_original} 的 ${metricNames[metric]} · ${modeNames[mode]}。`);
    } catch (error) {
      if (version === chartVersion) setStatus(`图表绘制失败：${error.message}`, true);
    }
  }
  async function selectRegion(id) {
    if (id === '__all') { void renderGallery(); return; }
    clearGallery();
    const token = ++selectedToken;
    selectedRegion = countryEntities(els.country.value).find(region => region.id === id) || null;
    if (!selectedRegion) { clearSelection('未找到所选产区。'); return; }
    showRegionMeta(selectedRegion, null);
    if (!selectedRegion.series_file) {
      clearSelection(`${displayName(selectedRegion)}：${missingSeriesText(selectedRegion)}`);
      els.regionHead.hidden = false;
      els.details.hidden = false;
      return;
    }
    if (els.section.hidden) {
      clearSelection('地区目录已就绪。打开“产区气候图”后读取所选序列。');
      els.regionHead.hidden = false;
      return;
    }
    clearSelection(`正在读取 ${selectedRegion.name || selectedRegion.name_zh || selectedRegion.name_original} 的当地日度序列…`);
    els.regionHead.hidden = false;
    try {
      const series = await loadSeries(selectedRegion);
      if (token !== selectedToken) return;
      if (series.schema_version !== 1 || !Array.isArray(series.daily) || !Array.isArray(series.columns))
        throw new Error('地区序列格式不符合 schema v1');
      selectedSeries = series;
      showRegionMeta(selectedRegion, series);
      signalsFor(series);
      renderAutoReading();
      void renderChart();
      if (els.section.hidden) setStatus('地区数据已就绪。点击“产区气候图”查看季节图。');
    } catch (error) {
      if (token === selectedToken) {
        selectedSeries = null;
        els.signals.hidden = true;
        els.chartCard.hidden = true;
        setStatus(`地区数据暂不可用：${error.message}`, true);
      }
    }
  }
  async function initClimate() {
    try {
      const response = await fetch(new URL('index.json', base), {cache: 'no-store'});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data.schema_version !== 1 || !Array.isArray(data.regions) || !Array.isArray(data.countries))
        throw new Error('数据目录格式不符合 schema v1');
      catalog = data;
      $('climate-region-count').textContent = String(data.regions.length);
      $('climate-series-count').textContent = String(data.regions.filter(region => region.series_file).length);
      $('climate-baseline-years').textContent = (data.source?.reference_years || [2006, 2025]).join('–');
      const dates = data.regions.map(region => region.coverage?.last_complete_date).filter(Boolean).sort();
      $('climate-latest-date').textContent = dates.length ? dates[dates.length - 1] : '—';
      els.generated.textContent = `目录生成：${fmtTimestamp(data.generated_utc)} · 数据源 ${data.source?.dataset || 'ERA5-Land'}`;
      populateCountries();
    } catch (error) {
      els.generated.textContent = '本地数据目录尚未就绪';
      setStatus(`无法读取 data/index.json：${error.message}。请使用本地预览服务打开，等待气候数据导出后刷新。`, true);
    }
  }
  els.country.addEventListener('change', () => { els.search.value = ''; populateMacroRegions(); populateRegions(); });
  els.scale.addEventListener('change', () => { els.search.value = ''; populateModes(); populateMacroRegions(els.macro.value); populateRegions(); });
  els.macro.addEventListener('change', () => { els.search.value = ''; populateRegions(); });
  els.search.addEventListener('input', () => populateRegions(els.region.value));
  els.region.addEventListener('change', () => void selectRegion(els.region.value));
  els.metric.addEventListener('change', () => { populateModes(); void renderChart(); });
  els.mode.addEventListener('change', () => void renderChart());
  function activateClimate() {
    requestAnimationFrame(() => {
      if (isGallery()) { void renderGallery(); return; }
      if (!selectedSeries && els.region.value) void selectRegion(els.region.value);
      else void renderChart();
    });
  }
  document.querySelector('[data-view="climate"]')?.addEventListener('click', activateClimate);
  window.addEventListener('hashchange', () => { if (location.hash === '#climate') activateClimate(); });
  void initClimate();

  // 割胶风险导出与气候序列分开读取；没有导出文件时只显示明确的等待状态。
  const risk = {
    country: $('risk-country'), scale: $('risk-scale'), region: $('risk-region'),
    status: $('risk-data-status'), generated: $('risk-generated'),
    overview: $('risk-overview'), history: $('risk-history'), list: $('risk-list')
  };
  let tapping = null;
  const latestDay = entry => Array.isArray(entry?.daily) ? [...entry.daily].reverse().find(day => day?.date) : null;
  function riskLevel(level) {
    const value = String(level || '').toLowerCase();
    if (!value || value === 'null' || value === 'unknown') return ['数据不足', ''];
    if (value.includes('high') || value.includes('高') || value.includes('严重')) return ['高', 'is-high'];
    if (value.includes('medium') || value.includes('moderate') || value.includes('中')) return ['中', 'is-mid'];
    if (value.includes('low') || value.includes('低')) return ['低', 'is-low'];
    return [String(level), ''];
  }
  function pct(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
    const number = Number(value);
    return `${(number <= 1 ? number * 100 : number).toFixed(1)}%`;
  }
  function riskCard(label, value, note, alert = false) {
    const card = document.createElement('div');
    card.className = `risk-card${alert ? ' is-alert' : ''}`;
    const a = document.createElement('span'); a.textContent = label;
    const b = document.createElement('strong'); b.textContent = value;
    const c = document.createElement('small'); c.textContent = note;
    card.append(a, b, c);
    return card;
  }
  function riskRow(label, day, secondary = '') {
    const row = document.createElement('div'); row.className = 'risk-row';
    const name = document.createElement('strong'); name.textContent = label;
    const level = document.createElement('span');
    const [levelText, levelClass] = riskLevel(day?.risk_level);
    level.className = `risk-level ${levelClass}`; level.textContent = levelText;
    const amount = document.createElement('span'); amount.textContent = `${fmtDate(day?.date)} · 不利条件占比 ${pct(day?.adverse_share)}`;
    const reason = document.createElement('span');
    const weather = day ? [
      day.dawn_rain_mm == null ? '' : `清晨降水 ${Number(day.dawn_rain_mm).toFixed(1)} mm`,
      day.dawn_rain_hours == null ? '' : `清晨有雨 ${Number(day.dawn_rain_hours).toFixed(1)} 小时`,
      day.previous_night_rain_hours == null ? '' : `前夜有雨 ${Number(day.previous_night_rain_hours).toFixed(1)} 小时`
    ].filter(Boolean).join('、') : '';
    reason.textContent = [weather, Array.isArray(day?.reason) ? day.reason.join('；') : day?.reason, secondary]
      .filter(Boolean).join(' · ') || '暂无完整判断依据';
    row.append(name, level, amount, reason);
    return row;
  }
  function riskCountryIds() {
    return [...new Set([...(tapping.countries || []), ...(tapping.regions || []), ...(tapping.groups || [])]
      .map(item => item.country_iso3 || item.iso3).filter(Boolean))];
  }
  function riskEntities() {
    const country = risk.country.value;
    return risk.scale.value === 'subregion'
      ? (tapping.groups || []).filter(item => item.country_iso3 === country)
      : (tapping.regions || []).filter(item => item.country_iso3 === country);
  }
  function populateRiskRegions() {
    risk.region.replaceChildren();
    const mode = risk.scale.value;
    if (mode === 'country') {
      risk.region.append(option('', '国家概览'));
      risk.region.disabled = true;
    } else {
      const items = riskEntities();
      for (const item of items) risk.region.append(option(mode === 'subregion' ? item.group_id : item.id,
        item.label || item.name || item.name_zh || item.name_original || item.id));
      risk.region.disabled = !items.length;
    }
    renderRisk();
  }
  function renderRiskHistory(entry) {
    risk.history.replaceChildren();
    const summary = entry?.history_summary;
    if (!summary) { risk.history.hidden = true; return; }
    const title = document.createElement('h3'); title.textContent = '历史天气不利日数';
    const intro = document.createElement('p');
    intro.textContent = `${fmtDate(summary.period_start)}—${fmtDate(summary.period_end)}，按已知日统计；部分年份只覆盖所列日期，不能视为全年。未知日不计入不利比例，也不等于实际停割。`;
    const grid = document.createElement('div'); grid.className = 'risk-history-grid';
    for (const [key, label] of [['low', '低'], ['medium', '中'], ['high', '高'], ['unknown', '未知']]) {
      const card = document.createElement('div');
      const text = document.createElement('span'); text.textContent = `${label}级天气日`;
      const count = document.createElement('strong'); count.textContent = String(summary.counts?.[key] ?? '—');
      card.append(text, count); grid.append(card);
    }
    const years = document.createElement('div'); years.className = 'risk-history-years';
    for (const year of summary.yearly || []) {
      const line = document.createElement('div');
      line.textContent = `${year.year} 年 ${fmtDate(year.period_start)}—${fmtDate(year.period_end)}：中/高 ${year.adverse_days ?? '—'} 日，已知 ${year.known_days ?? '—'} 日，占已知日 ${pct(year.adverse_day_share_of_known)}；未知 ${year.counts?.unknown ?? '—'} 日。`;
      years.append(line);
    }
    risk.history.append(title, intro, grid, years);
    risk.history.hidden = false;
  }
  function renderRisk() {
    if (!tapping) return;
    const country = risk.country.value;
    const mode = risk.scale.value;
    const regions = (tapping.regions || []).filter(item => item.country_iso3 === country);
    const groups = (tapping.groups || []).filter(item => item.country_iso3 === country);
    const countryResult = (tapping.countries || []).find(item => (item.country_iso3 || item.iso3) === country);
    risk.overview.replaceChildren(); risk.list.replaceChildren();
    if (mode === 'country') {
      const valid = regions.filter(item => item.point_count > 0 &&
        latestDay(item)?.risk_level && latestDay(item).risk_level !== 'unknown');
      const nationalDay = latestDay(countryResult);
      const latest = nationalDay?.date || valid.map(item => latestDay(item).date).sort().at(-1);
      if (nationalDay) {
        const [levelText, levelClass] = riskLevel(nationalDay.risk_level);
        risk.overview.append(
          riskCard('已采样国别天气不利等级', levelText, `资料日期 ${fmtDate(latest)}`, levelClass === 'is-high'),
          riskCard('不利条件占比', pct(nationalDay.adverse_share),
            nationalDay.covered_reference_weight_share == null ? '去重格点等权样本诊断；非全国胶园比例' : '仅在已覆盖参考权重内计算'),
          riskCard('有格点且可判定的产区', String(valid.length), `${regions.length} 个候选产区；大区结果见下方`)
        );
        risk.overview.append(
          nationalDay.covered_reference_weight_share == null
            ? riskCard('目录地区覆盖', `${valid.length} / ${regions.length}`, '国别格点等权诊断，无面积权重覆盖率')
            : riskCard('已采样地区参考权重覆盖', pct(nationalDay.covered_reference_weight_share),
              `有格点可判定地区 ${valid.length} / ${regions.length}；非胶园覆盖率`),
          riskCard('历史资料窗口', `${tapping.date_range?.days ?? '—'} 天`,
            `${fmtDate(tapping.date_range?.start)}—${fmtDate(tapping.date_range?.end)}`),
          riskCard('资料性质', '再分析', '不是实时天气或未来预报')
        );
      } else {
        risk.overview.append(
          riskCard('国别结果', '暂无', '不由重叠产区直接相加推算'),
          riskCard('最新资料日', fmtDate(latest), '历史再分析，不是未来预测'),
          riskCard('有格点且可判定的产区', String(valid.length), `${regions.length} 个候选产区`)
        );
      }
      const listed = groups.length ? groups : regions;
      for (const item of listed) risk.list.append(riskRow(item.label || item.name || item.name_zh || item.name_original || item.id,
        latestDay(item), `${item.region_ids?.length || item.point_count || 0} 个${groups.length ? '候选产区' : '格点'}`));
      risk.status.textContent = `${countryNames.get(country) || country}：显示导出的国别历史诊断，并浏览${groups.length ? '大区' : '产区'}结果。${countryResult?.quality_warning || ''} 不同层级和重叠产区不能重复相加。`;
      renderRiskHistory(countryResult);
    } else {
      const item = riskEntities().find(entry =>
        (mode === 'subregion' ? entry.group_id : entry.id) === risk.region.value);
      if (!item) {
        risk.status.textContent = '此层级暂无可查看的导出结果。';
        risk.overview.hidden = true; risk.history.hidden = true; risk.list.hidden = true; return;
      }
      const day = latestDay(item);
      const [levelText, levelClass] = riskLevel(day?.risk_level);
      const hasReferenceCoverage = day?.covered_reference_weight_share != null;
      risk.overview.append(
        riskCard('最新历史天气不利等级', levelText, `资料日期 ${fmtDate(day?.date)}`, levelClass === 'is-high'),
        riskCard('不利条件占比', pct(day?.adverse_share), '仅在已覆盖格点/地区权重内计算'),
        riskCard(hasReferenceCoverage ? '已采样地区参考权重覆盖' : '已选格点数据完整权重',
          pct(day?.covered_reference_weight_share ?? day?.covered_point_weight_share),
          hasReferenceCoverage ? `有效地区 ${day?.valid_region_count ?? '—'} / ${day?.region_count ?? '—'}；非胶园覆盖率`
            : `有效格点 ${day?.valid_point_count ?? '—'} / ${day?.point_count ?? item.point_count ?? '—'}；非地理覆盖率`)
      );
      if (mode === 'region' && Array.isArray(item.point_ids)) {
        const pointDays = (tapping.points || []).filter(point => item.point_ids.includes(point.id))
          .map(point => latestDay(point)).filter(pointDay => pointDay?.date === day?.date);
        const dawnRain = pointDays.map(pointDay => pointDay.dawn_rain_mm).filter(value => Number.isFinite(Number(value)));
        const nightHours = pointDays.map(pointDay => pointDay.previous_night_rain_hours).filter(value => Number.isFinite(Number(value)));
        const range = (values, unit) => values.length
          ? `${Math.min(...values).toFixed(1)}${values.length > 1 ? `–${Math.max(...values).toFixed(1)}` : ''} ${unit}` : '—';
        risk.overview.append(
          riskCard('入选格点主要窗口降水', range(dawnRain, 'mm'), `${tapping.method?.local_windows?.dawn || '以数据说明为准'} · ${dawnRain.length} 个有效格点`),
          riskCard('入选格点割前有雨', range(nightHours, '小时'), `${tapping.method?.local_windows?.previous_night || '以数据说明为准'} · ${nightHours.length} 个有效格点`),
          riskCard('关联暂定格点', String(item.point_count ?? item.point_ids.length), item.quality_warning || '格点不等于整片胶园')
        );
        const referenceTons = day?.reference_annual_production_exposed_tons_proxy;
        const referenceArea = day?.tappable_area_exposed_ha_proxy;
        if (referenceTons != null) risk.overview.append(riskCard(
          '参考年产量天气暴露当量', `${(Number(referenceTons) / 10000).toFixed(2)} 万吨`,
          `${item.reference?.year || '参考年'}产量 × 暂定格点不利比例；不是当天减产`, true));
        if (referenceArea != null) risk.overview.append(riskCard(
          '参考可割面积天气暴露当量', `${Number(referenceArea).toLocaleString('zh-CN', {maximumFractionDigits: 0})} 公顷`,
          '仅多格点低可信试算；不是已核实受影响面积', true));
      } else {
        risk.overview.append(
          riskCard('有效候选产区', String(day?.valid_region_count ?? '—'), `目录共 ${day?.region_count ?? item.region_ids?.length ?? '—'} 区`),
          riskCard('参考权重口径', weightBasisLabel(day?.weight_basis || item.weight_basis), '仅已采样地区历史天气'),
          riskCard('资料性质', '再分析', '不是实时天气或未来预报')
        );
      }
      for (const record of [...(item.daily || [])].slice(-12).reverse())
        risk.list.append(riskRow(item.label || item.name || item.name_zh || item.name_original || item.id, record));
      risk.status.textContent = `${item.label || item.name || item.name_zh || item.name_original || item.id} · ${mode === 'subregion' ? '大区' : '产区'}历史回分析。${item.quality_warning || ''}`;
      renderRiskHistory(item);
    }
    risk.overview.hidden = false; risk.list.hidden = false;
  }
  async function initRisk() {
    try {
      const response = await fetch(new URL('tapping.json', base), {cache: 'no-store'});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (![1, 2, 3].includes(data.schema_version) || !Array.isArray(data.regions)) throw new Error('割胶风险文件格式不符合支持的版本');
      tapping = data;
      if (!risk.country) { renderAutoReading(); return; }
      const method = data.method || {};
      $('risk-method-text').textContent = [
        `资料：${data.observation_type || 'ERA5-Land 历史再分析'}；${fmtDate(data.date_range?.start)}—${fmtDate(data.date_range?.end)}。`,
        `前夜窗口：${method.local_windows?.previous_night || '—'}；清晨窗口：${method.local_windows?.dawn || '—'}。有雨小时阈值：${method.rain_hour_threshold_mm ?? '—'} mm/h。`,
        ...Object.entries(method.risk_rules || {}).map(([key, rule]) => `${riskLevel(key)[0]}：${rule}`),
        method.threshold_status || '',
        method.adverse_share_definition || '',
        data.global_warning || ''
      ].filter(Boolean).join('\n');
      risk.generated.textContent = `历史回分析 · 导出 ${fmtTimestamp(data.generated_at_utc || data.generated_utc)}`;
      risk.country.replaceChildren();
      for (const iso3 of riskCountryIds()) {
        const country = (data.countries || []).find(item => (item.country_iso3 || item.iso3) === iso3);
        risk.country.append(option(iso3, country?.label || countryNames.get(iso3) || iso3));
      }
      risk.country.disabled = !risk.country.options.length;
      risk.scale.disabled = !risk.country.options.length;
      if (risk.country.options.length) { risk.scale.value = 'country'; populateRiskRegions(); }
      else risk.status.textContent = '割胶风险文件已读取，但没有可查看的地区。';
      renderAutoReading();
    } catch (error) {
      if (!risk.country) return;
      risk.generated.textContent = '等待本地风险数据导出';
      risk.status.textContent = `尚未读取 data/tapping.json（${error.message}）。此处暂不显示任何模拟风险等级。`;
      risk.overview.hidden = true; risk.history.hidden = true; risk.list.hidden = true;
    }
  }
  risk.country?.addEventListener('change', populateRiskRegions);
  risk.scale?.addEventListener('change', populateRiskRegions);
  risk.region?.addEventListener('change', renderRisk);
  void initRisk();
})();
