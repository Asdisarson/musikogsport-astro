# 02 Backfill + inference

Type: task
Status: done (applied to the local database)
Blocked by: 01
See map.md.

## Rules (rule tables at the top of mos-catalog-clean.php)

- Brand: `pa_vorumerki` by normalised key, else the first 1–3 words of the name; 13 brand terms created up front
  (Bula, Camelbak, Cintamani, Compressport, Cébé, Heelys, Jordan, Kombi, Reisport, Sklz, Smartwool, Tabedesign,
  Tape Design) so one apply is enough.
- Gender: `pa_aldur` Börn → Börn; `pa_kyn` Karl/Kona/Unisex → Karlar/Konur/both; else IS+EN name words.
- Sport: category map first, then name stems (hjólaskór and hlaupahjól excluded). New sport terms: Hjól, Pilates.
- Colour: first colour the name names (IS inflections, dökk-/ljós-, EN); none for "nokkrir litir"/multi.

## Result (local, 2026-10-29, published products)

| Field | Before | After |
|---|---|---|
| brand | 86.4% | 93.1% |
| gender | 62.6% | 93.2% |
| sport | 8.7% | 37.0% |
| colour | 1.5% | 39.4% |

16 sport conflicts left empty (indoor shoes handbolti|körfubolti, yoga|pilates, skíði|snjóbretti …).
60-product random sample read by eye: no wrong value found. Store API: colour counts = filtered listings (0 mismatches,
`tests/store_api_colour_test.py`).
