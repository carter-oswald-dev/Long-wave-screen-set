# Longwave

Flashes your screen with the on/off timing of five longwave time-code
radio stations — DCF77, MSF, WWVB, JJY, and BPC — so a nearby
radio-controlled clock can sync as if it were receiving the real
broadcast. No server, no build step, no dependencies.

## Run it

**Locally, offline:** open `index.html` directly in a browser, or serve
the folder with anything static:

```
python3 -m http.server 8000
```

then visit `http://localhost:8000`.

**As a GitHub Pages site:** push these three files (`index.html`,
`protocols.js`, `flicker.js`) to a repo and enable Pages on that branch.
Nothing else is needed.

## How it works

- `protocols.js` — pure functions that take a JS `Date` and produce the
  exact per-second bit pattern each station transmits, converting your
  computer's clock into whatever local time base and timezone/DST
  convention that station uses (see the in-app notes for details per
  station).
- `flicker.js` — turns those per-second patterns into full-screen
  black/white flashes, timed against real wall-clock seconds via
  `requestAnimationFrame` and `performance.now()`.
- `index.html` — the station picker and the fullscreen transmission
  surface.

## Accuracy notes

- DCF77, MSF, WWVB, and JJY are encoded against publicly documented,
  authoritative specifications (PTB, NPL/Ofcom successor docs, NIST
  Special Publication 432, and NICT respectively) and have been checked
  bit-for-bit against a full year of test dates, including both
  Northern Hemisphere DST transitions.
- BPC has no official public specification. The layout here follows
  community reverse-engineering (sourced from Wikipedia's BPC article)
  and has been cross-checked against one real captured BPC sample, but
  should be treated as less certain than the other four.
- Whether the flicker technique actually reaches a given clock depends
  entirely on that screen and that clock's receiver — there's no way to
  guarantee it in software. Try a few screen/clock distances and
  orientations before concluding it won't work.
