/* Accessibility helpers for the visual layer; no data or chart changes. */
(() => {
  'use strict';
  document.querySelectorAll('a[href="#daily-content"]').forEach(link => {
    link.addEventListener('click', event => {
      // Keep the active view hash: the original navigation uses #enso/#risk/etc.
      event.preventDefault();
      const target = link.classList.contains('site-skip-link')
        ? document.querySelector('main.wrap > section:not([hidden]) h2')
        : document.getElementById('daily-content');
      if (!target) return;
      target.setAttribute('tabindex', '-1');
      target.focus({preventScroll:true});
      target.scrollIntoView({block:'start', behavior:'auto'});
    });
  });

  // A chart first drawn in an inactive section can keep Plotly's 700px fallback.
  // Observe its real container width so column changes and view switches resize
  // the drawing, without rebuilding traces or changing the zoom/data values.
  if (typeof ResizeObserver === 'undefined' || typeof MutationObserver === 'undefined') return;
  const widths = new WeakMap();
  const observed = new WeakSet();
  const legendHooks = new WeakMap();
  const pending = new Set();
  const formatting = new WeakSet();
  const positionComparisonLegend = plot => {
    if (plot.id !== 'tb-comparison-chart' || formatting.has(plot) || !plot.getBoundingClientRect().width) return;
    const legend = plot.querySelector('.legend');
    if (!legend || !window.Plotly?.relayout || !plot.layout) return;
    const top = Math.max(48, Math.ceil(legend.getBoundingClientRect().height) + 22);
    if (plot.layout.legend?.y === 1.04 && plot.layout.legend?.yanchor === 'bottom' && plot.layout.margin?.t === top && plot.layout.margin?.b === 52) return;
    formatting.add(plot);
    // Keep the year legend away from the curves, with enough room for wrapping.
    Promise.resolve(window.Plotly.relayout(plot, {
      'legend.x':0, 'legend.xanchor':'left', 'legend.y':1.04,
      'legend.yanchor':'bottom', 'margin.t':top, 'margin.b':52
    })).catch(() => {}).finally(() => formatting.delete(plot));
  };
  let frame = 0;
  const resize = new ResizeObserver(entries => {
    for (const {target, contentRect} of entries) {
      const old = widths.get(target);
      widths.set(target, contentRect.width);
      if (contentRect.width > 0 && (old === undefined || Math.abs(old - contentRect.width) > .5)) pending.add(target);
    }
    if (frame || !pending.size) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      for (const plot of pending) {
        if (plot.getBoundingClientRect().width && plot.querySelector('.main-svg') && window.Plotly?.Plots?.resize) {
          Promise.resolve(window.Plotly.Plots.resize(plot)).then(() => positionComparisonLegend(plot)).catch(() => {});
        }
      }
      pending.clear();
    });
  });
  const watchPlots = () => {
    document.querySelectorAll('.js-plotly-plot').forEach(plot => {
      if (!observed.has(plot)) {
        observed.add(plot);
        resize.observe(plot);
      }
      if (plot.id === 'tb-comparison-chart' && typeof plot.on === 'function') {
        if (legendHooks.get(plot) !== plot.on) {
          plot.on('plotly_afterplot', () => positionComparisonLegend(plot));
          legendHooks.set(plot, plot.on);
        }
        positionComparisonLegend(plot);
      }
    });
  };
  let discoverFrame = 0;
  const discovery = new MutationObserver(() => {
    if (discoverFrame) return;
    discoverFrame = requestAnimationFrame(() => {
      discoverFrame = 0;
      watchPlots();
    });
  });
  const main = document.getElementById('daily-content');
  if (main) discovery.observe(main, {childList:true, subtree:true});
  watchPlots();
})();
