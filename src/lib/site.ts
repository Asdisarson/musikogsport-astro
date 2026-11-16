// The store's own accounts, named once (footer, phone menu, the home page's Instagram row).

export const INSTAGRAM_HANDLE = 'musikogsport';
export const INSTAGRAM_URL = `https://www.instagram.com/${INSTAGRAM_HANDLE}/`;

/** Recognitions shown in the footer above the link columns, files in public/vidurkenningar/. A new year's badge: add the
 *  file and change the entry (width/height are the file's own pixels, so the row never jumps while it loads). */
export const FOOTER_AWARDS: { src: string; alt: string; width: number; height: number }[] = [];
