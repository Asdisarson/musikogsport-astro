// The store's own accounts, named once (footer, phone menu, the home page's Instagram row).

export const INSTAGRAM_HANDLE = 'musikogsport';
export const INSTAGRAM_URL = `https://www.instagram.com/${INSTAGRAM_HANDLE}/`;

/** Recognitions shown in the footer right of the link columns, after the footer logo, files in public/vidurkenningar/. A new year's badge: add the
 *  file and change the entry (width/height are the file's own pixels, so the row never jumps while it loads). */
export const FOOTER_AWARDS: { src: string; alt: string; width: number; height: number }[] = [
  { src: '/vidurkenningar/framurskarandi-fyrirtaeki-2026.jpg', alt: 'Framúrskarandi fyrirtæki 2026', width: 366, height: 360 },
  { src: '/vidurkenningar/fyrirmyndarfyrirtaeki-2021-2026.jpg', alt: 'Fyrirmyndarfyrirtæki í rekstri 2021–2026, Viðskiptablaðið og Keldan', width: 542, height: 360 },
];
