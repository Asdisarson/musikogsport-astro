// The store's own accounts, named once (footer, phone menu, the home page's Instagram row).

export const INSTAGRAM_HANDLE = 'musikogsport';
export const INSTAGRAM_URL = `https://www.instagram.com/${INSTAGRAM_HANDLE}/`;

type FooterImage = { src: string; alt: string; width: number; height: number };
const MEDIA = 'https://wp.musikogsport.is/wp-content/uploads/2026/11';

// The footer's pictures: small WebP copies uploaded to the WordPress media library and linked here by URL (the Forsíða
// "Merki í fæti" field is not read for the footer). To change one, upload the new file and change its entry;
// width/height are the file's own pixels, so the row never jumps while it loads.

/** The logo shown in the footer, right of the link columns. */
export const FOOTER_LOGO: FooterImage = { src: `${MEDIA}/musikogsport-merki-fotur.webp`, alt: '', width: 556, height: 360 };

/** Recognitions shown after the footer logo. */
export const FOOTER_AWARDS: FooterImage[] = [
  { src: `${MEDIA}/framurskarandi-fyrirtaeki-2026.webp`, alt: 'Framúrskarandi fyrirtæki 2026', width: 366, height: 360 },
  { src: `${MEDIA}/fyrirmyndarfyrirtaeki-2021-2026.webp`, alt: 'Fyrirmyndarfyrirtæki í rekstri 2021–2026, Viðskiptablaðið og Keldan', width: 542, height: 360 },
];
