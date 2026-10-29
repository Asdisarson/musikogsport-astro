# 05 Content, contact, legal, error pages, signed-out login

Type: task
Status: built, awaiting user review (review page: https://claude.ai/artifact/PAj89fHkHy7KKr4gbHk4vC)
Blocked by: 00

## Question

Contact icons:
- `wpbakery.ts` keeps the linecons name (`vc_li-t-shirt`, `vc_li-location`, `vc_li-user`). Write the test first,
  updating `wpbakery.test.ts:24-35`.
- Map each to the Icon glyph that matches its column's content. Unknown names render nothing.

Contact layout:
- Info values in ink at weight 500.
- Map clamp(360px, 36vw, 520px), 300px on mobile, with a placeholder background.
- Content rows capped at 1140px.
- Form max 720px, centred, under a heading; Nafn and Netfang side by side.
- 44px tap targets.

Other pages:
- The older `.page-head`/`.prose` pages restyled.
- NotFound/503 copy balanced.
- Login: centred on mobile, 44px eye button, underlined lost-password link, remember-me row on one line.

Closes:
- contact: empty-icon-circles, form-full-width, form-no-heading-english-note, map-too-tall, mobile-map-blank-void,
  bold-values-unstyled, info-type-and-link-affordance, mobile-tap-targets, mobile-info-stack-too-long,
  desktop-columns-scattered, mobile-submit-small
- account: mobile-form-off-centre, eye-tap-target, lost-password-link-affordance, mobile-remember-row-stacked,
  mobile-dead-space-before-footer, box-padding-rhythm, submit-button-colour-mismatch
- pdp: error-page-orphan

## Answer

Built in `84075eb`. The user asked to carry on through every area without waiting, so this went straight on to /ship.

**Contact:**
- `wpbakery.ts`: `vc_icon` now carries a `glyph` from `ICON_GLYPHS` (`vc_li-t-shirt`→phone, `vc_li-location`→pin,
  `vc_li-user`→user). Unknown or non-linecons icons push no block. Written test first (3 failing, then green); the
  suite is 161.
- `WpContent.astro` renders `<Icon>` inside `.vc-icon`.
- `.wp-page` rows capped at 1140px; `b`/`strong` in ink at 500; links underlined in ink.
- map at `clamp(360px, 36vw, 520px)` (300px on phones) on a `--surface` placeholder
- on phones, a tighter stack and 44px inline link hit areas
- `ContactForm.astro`: an "Sendu okkur skilaboð" heading and a `.contact-form__pair` wrapper (2 columns ≥768); the form
  is 720px, centred, with Senda full width on phones

**Content pages:** `.page-head h1` at 41.6px, `.prose` a centred 720px column, `.prose a:not(.btn)` (the underlined
"Skoða vörur" button is fixed).

**404/503:** balanced text, a lighter 96px code (72px on phones), the cluster wraps, and phone buttons are full width
with a 20px inset.

**Login:**
- the eye is 44x44
- the lost link is underlined with a 44px target
- the submit uses `--btn-strong`
- on phones: centred with 20/20 insets (was 41/26), borderless, the remember row on one line, less space before the
  footer

**Gates:**
- vitest 161/161, `astro check` 0 errors, build green
- routes 27/31 and crawl 22: the baseline

**Probe** (`harness/area05-probe.mjs`):
- 3/3 icons show an SVG; the form's FormData is still name/email/topic/message; the pair has 2 columns; the map is
  518px; 0 overflow
- the eye is 44x44 and switches password→text; the lost link is 95x44
- phone login insets 20/20, with the row centred on one line
- 404 buttons inset 20/20 at 48px; the status is 404

Ultracode was off, so there was no multi-agent review.
