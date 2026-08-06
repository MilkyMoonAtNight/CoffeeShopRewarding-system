/*
 * Shared drink-panel renderer.
 * Builds an <svg> string of diagonally-skewed, stacked colour bands — one per
 * layer — that fills a drink card. Layers are ordered TOP → BOTTOM (layers[0]
 * is the top of the cup). Each band is a parallelogram sharing the same "/"
 * slant as its neighbours, so bands tile with no gaps and no overlap.
 *
 * textureMap: { slug: { baseColor, dots, dotColor, dotDensity, name } }
 *
 * Used by the order modal (item-modal.ejs) and the admin live preview
 * (admin/drinks.ejs). The server renders the same look in partials/drink-panel.ejs.
 */
(function (global) {
  var SEQ = 0;
  var NEUTRAL = '#F0E6D4';

  function buildDrinkPanelSVG(layers, textureMap, opts) {
    opts = opts || {};
    var W = opts.w || 120;
    var H = opts.h || 90;
    var S = 14;          // slant amount (px) — bigger = steeper "/"
    var XL = -20, XR = W + 20;
    var uid = 'dp' + (++SEQ) + Math.random().toString(36).slice(2, 6);
    textureMap = textureMap || {};

    // Keep only layers that resolve to a known texture with a positive pct.
    var valid = (layers || []).filter(function (l) {
      return l && textureMap[l.textureSlug] && Number(l.pct) > 0;
    });
    var sum = valid.reduce(function (s, l) { return s + Number(l.pct); }, 0);

    // No usable layers → a plain neutral panel.
    if (!valid.length || sum <= 0) {
      return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" class="drink-panel-svg">'
           + '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="' + NEUTRAL + '"/></svg>';
    }

    var defs = '';
    var bands = '';
    var yCursor = 0;

    for (var i = 0; i < valid.length; i++) {
      var l = valid[i];
      var tex = textureMap[l.textureSlug];
      var h = (Number(l.pct) / sum) * H;
      var yTop = yCursor;
      var yBot = yCursor + h;
      yCursor = yBot;

      // Extend the outermost bands past the edges so the slant fills the corners.
      var tExt = (i === 0) ? -40 : yTop;
      var bExt = (i === valid.length - 1) ? H + 40 : yBot;

      var pts = XL + ',' + (tExt + S).toFixed(1) + ' '
              + XR + ',' + (tExt - S).toFixed(1) + ' '
              + XR + ',' + (bExt - S).toFixed(1) + ' '
              + XL + ',' + (bExt + S).toFixed(1);

      bands += '<polygon points="' + pts + '" fill="' + tex.baseColor + '"/>';

      // Optional dot overlay (e.g. Milk).
      if (tex.dots) {
        var density = Math.max(1, Math.min(10, tex.dotDensity || 5));
        var space = Math.round(18 - density * 1.2); // denser = smaller spacing
        var pid = uid + '_d' + i;
        defs += '<pattern id="' + pid + '" width="' + space + '" height="' + space
             + '" patternUnits="userSpaceOnUse">'
             + '<circle cx="' + (space / 2).toFixed(1) + '" cy="' + (space / 2).toFixed(1)
             + '" r="1.3" fill="' + (tex.dotColor || '#9a9a9a') + '" opacity="0.55"/></pattern>';
        bands += '<polygon points="' + pts + '" fill="url(#' + pid + ')"/>';
      }
    }

    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" '
         + 'xmlns="http://www.w3.org/2000/svg" class="drink-panel-svg">'
         + (defs ? '<defs>' + defs + '</defs>' : '')
         + bands + '</svg>';
  }

  global.buildDrinkPanelSVG = buildDrinkPanelSVG;
})(typeof window !== 'undefined' ? window : this);
