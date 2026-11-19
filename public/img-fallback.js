// Product photos (ProductImage.astro, marked data-fallback): most local media files 404, and a production photo can be
// missing too, so a broken one shows /placeholder.svg instead. A failed srcset candidate first falls back to the
// plain src (with a srcset the browser ignores src, so it has to go), then a src that fails its own probe becomes
// the placeholder, once. An external file, so `script-src 'self'` allows it once the CSP is enforced (an inline onerror would be
// blocked). Loaded with `defer` from Base.astro: images that failed before it ran are fixed by the scan below.
(function () {
  var PLACEHOLDER = '/placeholder.svg';

  // An img inside <picture> (the AVIF/WebP light sources, ProductImage/HeroSlider/BannerRow): a source that failed
  // is removed, or the browser keeps choosing it. The img's own src and srcset have not been tried yet at this point.
  function dropSources(img) {
    var pic = img.parentNode;
    if (!pic || pic.tagName !== 'PICTURE') return false;
    var sources = pic.querySelectorAll('source');
    for (var i = 0; i < sources.length; i++) sources[i].remove();
    return sources.length > 0;
  }

  function placeholder(img) {
    img.removeAttribute('data-fallback'); // never again, even if the placeholder fails
    img.src = PLACEHOLDER;
  }

  // Only the img's own src is left. One failure can be reported more than once (this listener, the already-broken
  // scan below, the island's handler, a stale event after the sources went), so the placeholder never follows
  // straight from an event: a probe of the src decides. A src that loads gets one reload; if it then fails again,
  // the placeholder.
  function trySrc(img) {
    if (img.src.indexOf(PLACEHOLDER) !== -1) return;
    if (img.hasAttribute('data-reloaded')) return placeholder(img);
    if (img.hasAttribute('data-probing')) return;
    img.setAttribute('data-probing', '');
    var src = img.src;
    var probe = new Image();
    probe.onload = function () {
      img.removeAttribute('data-probing');
      img.setAttribute('data-reloaded', '');
      img.src = src;
    };
    probe.onerror = function () {
      img.removeAttribute('data-probing');
      placeholder(img);
    };
    probe.src = src;
  }

  function fallback(img) {
    if (!img || img.tagName !== 'IMG' || !img.hasAttribute('data-fallback')) return;
    if (dropSources(img)) return;
    if (img.hasAttribute('srcset')) {
      img.removeAttribute('srcset');
      return;
    }
    trySrc(img);
  }

  // `error` doesn't bubble: listen in the capture phase. Covers images added later (filter swaps, server islands).
  document.addEventListener('error', function (e) { fallback(e.target); }, true);

  // Already broken before this ran: tried (currentSrc set), finished, and no pixels.
  var imgs = document.querySelectorAll('img[data-fallback]');
  for (var i = 0; i < imgs.length; i++) {
    var img = imgs[i];
    if (img.complete && img.naturalWidth === 0 && img.currentSrc) fallback(img);
  }
})();
