// Product photos (ProductImage.astro, marked data-fallback): most local media files 404, and a production photo can be
// missing too, so a broken one shows /placeholder.svg instead. A failed srcset candidate first falls back to the
// plain src (with a srcset the browser ignores src, so it has to go), then a failed src becomes the placeholder,
// once. An external file, so `script-src 'self'` allows it once the CSP is enforced (an inline onerror would be
// blocked). Loaded with `defer` from Base.astro: images that failed before it ran are fixed by the scan below.
(function () {
  var PLACEHOLDER = '/placeholder.svg';

  function fallback(img) {
    if (!img || img.tagName !== 'IMG' || !img.hasAttribute('data-fallback')) return;
    if (img.hasAttribute('srcset')) {
      img.removeAttribute('srcset');
      return;
    }
    if (img.src.indexOf(PLACEHOLDER) === -1) {
      img.removeAttribute('data-fallback'); // never again, even if the placeholder fails
      img.src = PLACEHOLDER;
    }
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
