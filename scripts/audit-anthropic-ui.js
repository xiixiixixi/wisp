/**
 * Design audit for the Anthropic restyle — run inside the app page.
 *
 * Reports every element whose computed colour falls outside the DESIGN.md
 * palette, so hard-coded colours that token work alone would miss become
 * visible. Neutral grays and low-alpha composites are ignored because they are
 * structural (hairlines, disabled states, inset highlights).
 *
 * Usage (Sleuth shared browser, from the Wisp repo):
 *   JS=$(cat scripts/audit-anthropic-ui.js)
 *   node scripts/shared-browser.mjs exec --owner <id> --tab <label> -- eval "$JS"
 */
(() => {
  var OK = {
    '217,119,87': 1, '196,99,63': 1, '20,20,19': 1, '94,93,89': 1,
    '115,114,108': 1, '135,134,127': 1, '176,174,165': 1, '250,249,245': 1,
    '240,238,230': 1, '227,218,204': 1, '209,207,197': 1, '168,86,70': 1,
    '120,140,93': 1, '106,155,204': 1, '123,114,134': 1, '171,125,118': 1,
    '176,118,74': 1, '179,154,93': 1, '74,167,242': 1
  };
  var PROPS = ['backgroundColor', 'color', 'borderTopColor'];
  var bad = {};

  var els = document.querySelectorAll('*');
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    var r = el.getBoundingClientRect();
    if (r.width < 6 || r.height < 6) continue;
    var cs = getComputedStyle(el);
    for (var p = 0; p < PROPS.length; p++) {
      var prop = PROPS[p];
      var v = cs[prop];
      var m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(v);
      if (!m) continue;
      var key = m[1] + ',' + m[2] + ',' + m[3];
      var alpha = m[4] === undefined ? 1 : parseFloat(m[4]);
      if (alpha < 0.02) continue;
      if (OK[key]) continue;
      var nums = [+m[1], +m[2], +m[3]];
      if (Math.max.apply(null, nums) - Math.min.apply(null, nums) <= 6) continue;
      var id = prop + ':' + v;
      if (!bad[id]) bad[id] = { prop: prop, value: v, el: String(el.className || el.tagName).slice(0, 44), n: 0 };
      bad[id].n++;
    }
  }

  var list = Object.keys(bad).map(function (k) { return bad[k]; });
  list.sort(function (a, b) { return b.n - a.n; });
  return JSON.stringify({
    path: location.pathname,
    scanned: els.length,
    offenders: list.length,
    top: list.slice(0, 10)
  });
})()

