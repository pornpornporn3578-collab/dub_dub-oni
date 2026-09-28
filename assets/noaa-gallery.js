/* NOAA/CPC 原图导航。文件名沿用官方固定地址；图内日期以 NOAA 原图为准。 */
(() => {
  'use strict';

  const host = 'https://www.cpc.ncep.noaa.gov';
  const seBase = `${host}/products/JAWF_Monitoring/SEAsia/`;
  const seDaily = `${seBase}daily/`;
  const seGfs = `${host}/products/JAWF_Monitoring/GFS/`;
  const seTemp = `${host}/products/analysis_monitoring/regional_monitoring/`;
  const seMonthly = `${seBase}monthly/`;
  const afBase = `${host}/products/Global_Monsoons/African_Monsoons/`;
  const afRain = `${host}/products/Precip_Monitoring/Figures/Africa/`;
  const afGfs = `${host}/products/Precip_Monitoring/Figures/GFS/`;
  const soilBase = `${host}/soilmst/glb_d/`;
  const soilPage = `${host}/products/Soilmst_Monitoring/GLB/glb_s.shtml`;
  const seriesBase = `${host}/products/Global_Monsoons/Asian_Monsoons/click_map_ts/`;
  const seriesMap = `${seBase}JAWF_map_SEAsia.gif`;
  const item = (label, url) => ({label, url});

  const galleries = {
    seasia: {
      title: '一、东南亚',
      note: 'NOAA/CPC 原图。降水分析、气温和月度地图是已发生或模型分析；GFS 降水图是未来预测。',
      tabs: [
        {
          label: '降水分析', page: `${seBase}index.shtml`,
          groups: [
            {label: '累计降水', items: [item('过去1天', `${seDaily}p.1day.figa.gif`), item('过去7天', `${seDaily}p.7day.figa.gif`), item('过去15天', `${seDaily}p.15day.figa.gif`), item('过去30天', `${seDaily}p.30day.figa.gif`)]},
            {label: '降水距平', items: [item('过去7天', `${seDaily}p.7day.figb.gif`), item('过去15天', `${seDaily}p.15day.figb.gif`), item('过去30天', `${seDaily}p.30day.figb.gif`)]},
            {label: '站点', items: [item('每日站点分布', `${host}/products/JAWF_Monitoring/gnum/SEAsia_curr.p.gnum.gif`)]},
          ],
        },
        {
          label: 'GFS 降水预测', page: `${seBase}GFS_forecasts.shtml`,
          groups: [{label: '未来预测', items: [
            item('第1周累计', `${seGfs}SEAsia_curr.p.gfs1a.gif`),
            item('第1周距平', `${seGfs}SEAsia_curr.p.gfs1b.gif`),
            item('第2周累计', `${seGfs}SEAsia_curr.p.gfs2a.gif`),
            item('第2周距平', `${seGfs}SEAsia_curr.p.gfs2b.gif`),
          ]}],
        },
        {label: '降水时间序列', page: `${seBase}30d_time_series.shtml`, series: true,
          groups: [{label: '回看时段', items: [item('近30天', '30'), item('近90天', '90'), item('近180天', '180')]}]},
        {
          label: '气温观测', page: `${seBase}temperature.shtml`,
          groups: [
            {label: '每日', items: [item('最低气温', `${seTemp}dcmin5.png`), item('最高气温', `${seTemp}dcmax5.png`), item('平均气温', `${seTemp}dcavg5.png`)]},
            {label: '每周', items: [item('最低气温', `${seTemp}wcmin5.png`), item('最高气温', `${seTemp}wcmax5.png`), item('平均气温', `${seTemp}wcavg5.png`), item('气温距平', `${seTemp}wctan5.png`)]},
            {label: '每月', items: [item('平均气温', `${seTemp}1cavg5.png`), item('气温距平', `${seTemp}1ctan5.png`)]},
          ],
        },
        {
          label: '月度陆面地图', page: `${seBase}monthly_maps.shtml`,
          groups: [
            {label: '土壤湿度', items: [item('总量', `${seMonthly}w.f_area.gif`), item('距平', `${seMonthly}w.a_area.gif`)]},
            {label: '蒸发', items: [item('总量', `${seMonthly}e.f_area.gif`), item('距平', `${seMonthly}e.a_area.gif`)]},
            {label: '径流', items: [item('总量', `${seMonthly}r.f_area.gif`), item('距平', `${seMonthly}r.a_area.gif`)]},
            {label: '2米气温', items: [item('总量', `${seMonthly}t.f_area.gif`), item('距平', `${seMonthly}t.a_area.gif`)]},
          ],
        },
      ],
    },
    africa: {
      title: '二、非洲',
      note: '监测图反映已发生的降水，GFS 图是第1周和第2周的模式预测；科特迪瓦位于图中西非区域。',
      tabs: [
        {
          label: '降水监测', page: `${afBase}precip_monitoring.shtml`,
          groups: [
            {label: '累计降水', items: [item('过去1天', `${afRain}p.1day.figa.gif`), ...[7,30,90,180].map(n => item(`过去${n}天`, `${afRain}p.${n}day.figa.gif`))]},
            {label: '降水距平', items: [7,30,90,180].map(n => item(`过去${n}天`, `${afRain}p.${n}day.figb.gif`))},
          ],
        },
        {
          label: 'GFS 降水预测', page: `${afBase}gfs_model.shtml`,
          groups: [{label: '未来预测', items: [
            item('第1周累计', `${afGfs}AF_curr.p.gfs1a.gif`),
            item('第1周距平', `${afGfs}AF_curr.p.gfs1b.gif`),
            item('第2周累计', `${afGfs}AF_curr.p.gfs2a.gif`),
            item('第2周距平', `${afGfs}AF_curr.p.gfs2b.gif`),
          ]}],
        },
      ],
    },
    soil: {
      title: '三、土壤湿度',
      note: 'NOAA/CPC 全球陆面模型的当前图。距平单位为毫米，百分位数表示相对历史分布的位置；两者不是同一指标，图内日期为准。',
      tabs: [
        {label: '亚洲', page: soilPage, groups: [{label: '土壤湿度', items: [item('距平', `${soilBase}curr.w.a_as.gif`), item('百分位数', `${soilBase}rank_w.as.gif`)]}]},
        {label: '非洲', page: soilPage, groups: [{label: '土壤湿度', items: [item('距平', `${soilBase}curr.w.a_af.gif`), item('百分位数', `${soilBase}rank_w.af.gif`)]}]},
      ],
    },
  };

  // NOAA 图像坐标按原图 311 × 335 像素，SVG viewBox 会随屏幕等比缩放。
  const seriesAreas = [
    ['95','20N','rect','24,6,65,50'], ['100','20N','rect','64,6,106,50'],
    ['105','20N','poly','105,5,105,48,112,49,127,34,142,35,142,5'],
    ['110','20N','poly','142,6,143,35,167,33,181,24,181,4'],
    ['115','20N','poly','181,4,181,25,191,24,211,3'],
    ['95','15N','poly','25,49,24,90,41,75,49,94,65,96,65,46'],
    ['100','15N','rect','65,47,107,95'],
    ['105','15N','poly','106,48,106,94,135,95,115,67,115,49'],
    ['120','15N','poly','223,63,217,94,234,95,240,80,237,65'],
    ['95','10N','poly','46,96,56,125,65,124,66,92'],
    ['100','10N','poly','64,92,66,117,79,117,102,140,104,94,61,95'],
    ['105','10N','poly','103,93,104,139,117,139,135,128,138,96'],
    ['95','5N','poly','24,180,24,187,51,186'],
    ['100','5N','poly','65,171,69,186,89,187,89,181,84,173'],
    ['115','5N','poly','193,170,180,187,211,185,212,182'],
    ['120','5N','poly','257,145,245,157,254,174,261,179'],
    ['125','5N','poly','260,145,261,175,272,169,272,150'],
    ['95','0N','poly','27,188,59,228,65,229,65,203,48,185'],
    ['100','0N','poly','68,187,67,202,65,231,91,232,97,219,89,187'],
    ['105','0N','poly','146,215,136,213,133,225,136,233,146,232'],
    ['110','0N','poly','178,190,146,218,146,232,182,233,182,185,182,186,181,186'],
    ['115','0N','poly','181,187,183,232,202,230,212,223,202,189'],
    ['100','5S','poly','62,231,78,260,94,277,106,276,105,246,92,232'],
    ['105','5S','poly','106,246,105,276,114,276,116,257'],
    ['110','5S','poly','140,233,145,257,156,263,180,267,181,233'],
    ['115','5S','poly','180,233,182,267,194,255,196,242,205,231'],
    ['115','5S','poly','219,233,210,257,221,271'],
    ['120','5S','poly','219,234,221,272,246,277,244,261,243,242'],
    ['105','10S','poly','109,285,106,296,141,305,143,291,108,278'],
    ['110','10S','poly','142,287,142,307,170,308,170,296'],
  ];

  const state = {
    seasia: {tab: 0, choice: {}, grid: '100E15N'},
    africa: {tab: 0, choice: {}},
    soil: {tab: 0, choice: {}},
  };
  const $ = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const freshUrl = (url, force = false) => {
    const result = new URL(url);
    const today = new Date();
    const localDay = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');
    result.searchParams.set('day', localDay);
    if (force) result.searchParams.set('refresh', String(Date.now()));
    return result.href;
  };
  const allItems = tab => tab.groups.flatMap(group => group.items);
  const seriesLabel = grid => {
    const match = grid.match(/^(\d+)E(\d+)(N|S)$/);
    if (!match) return grid;
    const lon = Number(match[1]);
    const lat = Number(match[2]);
    const north = match[3] === 'N';
    const latText = north ? `北纬${lat}–${lat + 5}°` : `南纬${Math.max(0, lat - 5)}–${lat}°`;
    return `${latText}、东经${lon}–${lon + 5}°`;
  };
  const sourceLinks = (container, page, imageUrl, refresh) => {
    const links = $('div', 'noaa-links');
    const source = $('a', '', 'NOAA/CPC 来源页面 ↗');
    source.href = page;
    source.target = '_blank';
    source.rel = 'noopener noreferrer';
    const image = $('a', '', '打开当前原图 ↗');
    image.href = imageUrl;
    image.target = '_blank';
    image.rel = 'noopener noreferrer';
    const reload = $('button', 'noaa-refresh', '刷新当前图像');
    reload.type = 'button';
    reload.addEventListener('click', refresh);
    links.append(source, image, reload);
    container.append(links);
  };
  const imageWithStatus = (container, imageUrl, alt) => {
    const wrap = $('div', 'noaa-image-wrap');
    const img = $('img', 'noaa-product-image');
    img.alt = alt;
    img.loading = 'lazy';
    const status = $('p', 'noaa-status', '正在加载 NOAA 原图…');
    status.setAttribute('role', 'status');
    img.addEventListener('load', () => { status.textContent = '图内标注的日期是产品有效日期，请以原图为准。'; });
    img.addEventListener('error', () => { status.textContent = '图像暂时无法加载，请使用下方“打开当前原图”查看 NOAA 页面。'; });
    img.src = freshUrl(imageUrl);
    wrap.append(img);
    container.append(wrap, status);
    return img;
  };
  const seriesImage = (grid, days) => `${seriesBase}grid_${grid}_${days}d.gif`;

  function renderSeries(viewer, tab, chosenRange) {
    const grid = state.seasia.grid;
    const mapLayout = $('div', 'noaa-map-layout');
    const mapColumn = $('div', 'noaa-map-controls');
    const frame = $('div', 'noaa-map-frame');
    const mapImg = $('img');
    mapImg.src = freshUrl(seriesMap);
    mapImg.alt = '东南亚降水时间序列的可点击 5°×5° 网格地图';
    mapImg.width = 311;
    mapImg.height = 335;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 311 335');
    svg.setAttribute('aria-label', '点击地图网格查看降水时间序列');
    for (const [lon, lat, shape, coords] of seriesAreas) {
      const gridId = `${lon}E${lat}`;
      const node = document.createElementNS('http://www.w3.org/2000/svg', shape === 'rect' ? 'rect' : 'polygon');
      if (shape === 'rect') {
        const [x1, y1, x2, y2] = coords.split(',').map(Number);
        node.setAttribute('x', String(x1)); node.setAttribute('y', String(y1));
        node.setAttribute('width', String(x2 - x1)); node.setAttribute('height', String(y2 - y1));
      } else {
        node.setAttribute('points', coords.split(',').reduce((pairs, value, i, values) => {
          if (i % 2 === 0) pairs.push(`${value},${values[i + 1]}`);
          return pairs;
        }, []).join(' '));
      }
      node.classList.add('noaa-map-hotspot');
      if (gridId === grid) node.classList.add('is-selected');
      node.setAttribute('role', 'button');
      node.setAttribute('tabindex', '0');
      node.setAttribute('aria-label', seriesLabel(gridId));
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = seriesLabel(gridId);
      node.append(title);
      const choose = () => { state.seasia.grid = gridId; renderGallery('seasia'); };
      node.addEventListener('click', choose);
      node.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(); }
      });
      svg.append(node);
    }
    frame.append(mapImg, svg);
    mapColumn.append(frame);
    const label = $('label', '', '或直接选择 5°×5° 网格');
    const select = $('select');
    const uniqueGrids = [...new Set(seriesAreas.map(area => `${area[0]}E${area[1]}`))];
    for (const gridId of uniqueGrids) {
      const option = $('option', '', seriesLabel(gridId));
      option.value = gridId;
      select.append(option);
    }
    select.value = grid;
    select.addEventListener('change', () => { state.seasia.grid = select.value; renderGallery('seasia'); });
    label.append(select);
    mapColumn.append(label);
    const chart = $('div', 'noaa-series-chart');
    chart.append($('h5', '', `${seriesLabel(grid)} · 近${chosenRange.label.replace(/\D/g, '')}天`));
    const chartUrl = seriesImage(grid, chosenRange.url);
    imageWithStatus(chart, chartUrl, `${seriesLabel(grid)}近${chosenRange.url}天降水时间序列`);
    sourceLinks(chart, `${seBase}${chosenRange.url}d_time_series.shtml`, chartUrl, () => {
      const img = chart.querySelector('img.noaa-product-image');
      img.src = freshUrl(chartUrl, true);
    });
    mapLayout.append(mapColumn, chart);
    viewer.append(mapLayout);
  }

  function renderGallery(id) {
    const root = document.getElementById(`noaa-${id}`);
    if (!root) return;
    const gallery = galleries[id];
    const current = state[id];
    const tab = gallery.tabs[current.tab];
    const choices = allItems(tab);
    const selected = Math.min(current.choice[current.tab] || 0, choices.length - 1);
    current.choice[current.tab] = selected;
    root.replaceChildren();
    root.append($('h4', '', gallery.title), $('p', 'noaa-section-note', gallery.note));

    const tabs = $('div', 'noaa-tabs');
    tabs.setAttribute('role', 'group');
    tabs.setAttribute('aria-label', `${gallery.title}栏目`);
    gallery.tabs.forEach((candidate, index) => {
      const button = $('button', '', candidate.label);
      button.type = 'button';
      button.setAttribute('aria-pressed', String(index === current.tab));
      button.addEventListener('click', () => { current.tab = index; renderGallery(id); });
      tabs.append(button);
    });
    root.append(tabs);

    const browser = $('div', 'noaa-browser');
    const options = $('div', 'noaa-options');
    let number = 0;
    tab.groups.forEach(group => {
      const groupEl = $('div', 'noaa-option-group');
      groupEl.append($('h5', '', group.label));
      group.items.forEach(choice => {
        const choiceIndex = number++;
        const button = $('button', '', choice.label);
        button.type = 'button';
        button.setAttribute('aria-pressed', String(choiceIndex === selected));
        button.addEventListener('click', () => { current.choice[current.tab] = choiceIndex; renderGallery(id); });
        groupEl.append(button);
      });
      options.append(groupEl);
    });
    browser.append(options);

    const viewer = $('div', 'noaa-viewer');
    if (tab.series) {
      renderSeries(viewer, tab, choices[selected]);
    } else {
      const choice = choices[selected];
      viewer.append($('h5', '', `${tab.label} · ${choice.label}`));
      imageWithStatus(viewer, choice.url, `${gallery.title}：${tab.label}，${choice.label}`);
      sourceLinks(viewer, tab.page, choice.url, () => {
        const img = viewer.querySelector('img.noaa-product-image');
        img.src = freshUrl(choice.url, true);
      });
    }
    browser.append(viewer);
    root.append(browser);
  }

  function setupMainNavigation() {
    const nav = document.querySelector('.dashboard-nav');
    if (!nav) return;
    // 原日报把代表点统计放在官方图之前；三栏导航下归入产区站点栏目。
    const stationSection = document.getElementById('station-section');
    const regionGrid = document.querySelector('.region-grid');
    const stationPicker = stationSection && stationSection.querySelector('.station-picker');
    if (regionGrid && stationPicker && !stationSection.contains(regionGrid)) {
      const intro = regionGrid.previousElementSibling;
      if (intro && intro.tagName === 'P') stationSection.insertBefore(intro, stationPicker);
      stationSection.insertBefore(regionGrid, stationPicker);
    }
    const views = new Set(['enso', 'official', 'stations']);
    const sections = [...document.querySelectorAll('main.wrap > section')];
    const buttons = [...nav.querySelectorAll('button[data-view]')];
    const show = (view, updateHash = true) => {
      const selected = views.has(view) ? view : 'enso';
      for (const section of sections) {
        const target = section.dataset.siteView || (section.classList.contains('kpis') ? 'enso' : 'enso');
        section.hidden = target !== selected;
      }
      for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.view === selected));
      if (updateHash) history.replaceState(null, '', `#${selected}`);
      window.scrollTo({top: 0, behavior: 'auto'});
    };
    for (const button of buttons) button.addEventListener('click', () => show(button.dataset.view));
    window.addEventListener('hashchange', () => show(location.hash.slice(1), false));
    show(location.hash.slice(1), false);
  }

  ['seasia', 'africa', 'soil'].forEach(renderGallery);
  setupMainNavigation();
})();
