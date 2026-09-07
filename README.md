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

DCF77, MSF, WWVB, and JJY are encoded against publicly documented,
authoritative specifications (PTB, NPL/Ofcom successor docs, NIST
Special Publication 432, and NICT respectively) and have been checked
bit-for-bit against a full year of test dates, including both
Northern Hemisphere DST transitions.

BPC has no official public specification, and its implementation went
through two rounds of fixes described below.

Whether the flicker technique actually reaches a given clock depends
entirely on that screen and that clock's receiver — there's no way to
guarantee it in software. Try a few screen/clock distances and
orientations before concluding it won't work.

## BPC: what was wrong, and what fixed it

**Round 1 — the original problem.** BPC (China, 68.5 kHz) has no
official published specification anywhere. The first version of this
app was built from a community reverse-engineered frame table (from
Wikipedia's "BPC (time signal)" article) and cross-checked against one
real captured BPC sample quoted in that article. That single sample
matched, but a full sweep across a year of test times turned up
failures: the hour field only had enough bits for values 0–15 and the
day-of-month field only had enough for 0–15, so any hour past 15:00 or
any day past the 15th of the month encoded wrong. The single sample
happened to use small values for both, so it didn't expose the problem.

**Round 2 — the fix, from a real hardware project.** The user then
supplied a zip of **[BPC_VFD_Clock](https://github.com/Belief997/BPC_VFD_Clock)**,
a hardware + firmware project (PCB design, an FPGA/Verilog BPC signal
*generator*, and PIC firmware that *receives and decodes* that same
signal). That project's two halves gave something no single reverse-engineered
sample could: an independent transmitter and receiver for the same
protocol, checkable against each other.

Reading `Software/zybo_test/bpc_gen.v` (the generator) alongside
`Software/micro_new/bpc.c` and `bpc.h` (the decoder) revealed the real
frame structure is simpler than the earlier guess: each of BPC's 20
seconds carries a single 2-bit value (0–3), sent as one of four pulse
widths (100/200/300/400 ms) — not two independent bits per second.
Rebuilding the encoder against this structure fixed the original
hour/day-of-month width bugs (hour is 12-hour format, 0–11, with a
separate AM/PM flag; day-of-month gets a full 6-bit field).

Simulating the generator and the decoder *together* — feeding the
generator's output into the decoder's own validation logic, in code,
across every hour and minute — also surfaced a bug in the original
hardware project itself: its transmit side computes the AM/PM +
parity byte one way, but its receive side checks a related-but-different
quantity, and for about half of all PM times the two disagree, so the
real firmware would have rejected its own generator's signal. The
encoder here reproduces the *decoder's* validation rule (since that's
what a real receiving clock enforces) rather than the generator's
inconsistent one.

**Result:** the BPC encoder was re-verified against a faithful port of
the real PIC decoder's logic across a full year of hourly test dates —
8,760 checks — with zero mismatches. That's now the most rigorously
checked of the five protocols in this app, because it's the only one
validated against another party's independent, working receiver code
rather than a specification document.

## Credits

- The screen-flicker technique itself is adapted from a 2003 CRT-era
  tool for DCF77 (`dcf77.c`), which used the same idea of flashing a
  monitor to leak enough EMI/optical signal for a nearby clock to read.
- The BPC protocol implementation is built from
  [BPC_VFD_Clock](https://github.com/Belief997/BPC_VFD_Clock) by
  Belief997 — see the "BPC: what was wrong, and what fixed it" section
  above for exactly how it was used.
