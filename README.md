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
- BPC has no official public specification. It was first built from
  community reverse-engineering (Wikipedia's BPC article) and checked
  against one real captured sample, but that source turned out to be
  ambiguous about field widths — it under-sized the hour and
  day-of-month fields, which only showed up as failures once tested
  against a wider range of times than the single sample covered.
  It was later rebuilt entirely from a real hardware project someone
  shared as a zip upload — **BPC_VFD_Clock**, which includes both a
  Verilog signal *generator* (`bpc_gen.v`) and independent PIC firmware
  that *receives and decodes* that same signal (`bpc.c`/`bpc.h`). Having both sides let the whole 20-second frame be
  cross-checked rather than reverse-engineered from one sample: each
  second turned out to carry a single 2-bit value (0-3) as one of four
  pulse widths, not two independent bits as the earlier table
  suggested, and simulating the generator and decoder together also
  surfaced a real bug in the original project's own firmware — its
  transmit-side AM/PM logic disagreed with its own receive-side check
  for about half of all PM times. The BPC encoder here reproduces the
  decoder's actual validation rule instead of the generator's
  inconsistent one, and has since been checked against a full year of
  hourly test dates with zero mismatches against a faithful port of
  that real decoder — the strongest verification of any of the five
  formats in this project.
- Whether the flicker technique actually reaches a given clock depends
  entirely on that screen and that clock's receiver — there's no way to
  guarantee it in software. Try a few screen/clock distances and
  orientations before concluding it won't work.

## Credits

- The screen-flicker technique itself is adapted from a 2003 CRT-era
  tool for DCF77 (`dcf77.c`), which used the same idea of flashing a
  monitor to leak enough EMI/optical signal for a nearby clock to read.
- The BPC protocol implementation is built directly from **BPC_VFD_Clock**,
  a hardware + firmware project (PCB design, Verilog BPC signal
  generator, and PIC receiver/decoder firmware) shared as a zip upload.
  Its generator and decoder, read together, are what corrected this
  app's BPC encoding from an under-specified guess into something
  verified against real, independent receiver logic.

