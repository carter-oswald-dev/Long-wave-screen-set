/*
 * protocols.js
 *
 * Bit/pulse encoders for longwave time-code radio signals:
 * DCF77 (Germany), MSF (UK), WWVB (USA), JJY (Japan), BPC (China).
 *
 * Each encoder takes a JS Date (a real timestamp) and returns a
 * per-second array of "pulses" describing how a receiver expects
 * the carrier envelope to behave during that second. The screen
 * flicker engine turns pulses into black/white timings.
 *
 * Pulse shape: { lowMs, highMs, pattern }
 *   - lowMs: milliseconds the carrier is "reduced" (rendered BLACK)
 *            at the *start* of the second
 *   - highMs: milliseconds the carrier is "full" (rendered WHITE)
 *             for the remainder of the second
 *   - pattern: optional array of {ms, level} sub-segments for
 *              protocols whose bit shapes aren't a simple low-then-high
 *              (used by MSF's 2-bit "low/high/low" A=0,B=1 case).
 *
 * All encoders are pure functions of (Date) -> frame descriptor.
 * No wall-clock or DOM access happens in this file.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TimeCodeProtocols = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- helpers ----------

  function bcdDigit(n) {
    // returns array of 4 bits [b0,b1,b2,b3] i.e. weights 1,2,4,8 (LSB first)
    return [n & 1, (n >> 1) & 1, (n >> 2) & 1, (n >> 3) & 1];
  }

  function bitsForWeights(value, weights) {
    // weights: array of place values, e.g. [40,20,10,0,8,4,2,1] (0 = unused/reserved)
    // returns array of bits same length as weights, MSB-first as given
    let remaining = value;
    const bits = [];
    for (const w of weights) {
      if (w === 0) {
        bits.push(0);
        continue;
      }
      if (remaining >= w) {
        bits.push(1);
        remaining -= w;
      } else {
        bits.push(0);
      }
    }
    return bits;
  }

  function evenParity(bitsArr) {
    const ones = bitsArr.reduce((a, b) => a + b, 0);
    return ones % 2; // bit that makes total ones even is this value XORed appropriately by caller
  }

  function dayOfYear(date) {
    const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const cur = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    return Math.floor((cur - start) / 86400000) + 1;
  }

  function isLeapYear(y) {
    return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  }

  // Compute local civil time (with DST) for a named IANA zone using Intl,
  // without any external library. Returns { year, month(1-12), day, hour,
  // minute, second, weekday(0=Sun..6=Sat), isDST, utcOffsetMinutes }.
  function civilTimeInZone(date, timeZone) {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      weekday: 'short'
    });
    const parts = dtf.formatToParts(date);
    const map = {};
    for (const p of parts) map[p.type] = p.value;
    const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

    const year = parseInt(map.year, 10);
    const month = parseInt(map.month, 10);
    const day = parseInt(map.day, 10);
    let hour = parseInt(map.hour, 10);
    if (hour === 24) hour = 0;
    const minute = parseInt(map.minute, 10);
    const second = parseInt(map.second, 10);
    const weekday = weekdayMap[map.weekday];

    // Determine UTC offset in minutes by comparing formatted wall time to the
    // actual UTC instant.
    const asUTC = Date.UTC(year, month - 1, day, hour, minute, second);
    const offsetMinutes = Math.round((asUTC - date.getTime()) / 60000);

    // Determine whether DST is active by comparing offset to the zone's
    // known winter (January) standard offset.
    const janProbe = new Date(Date.UTC(date.getUTCFullYear(), 0, 15, 12, 0, 0));
    const janParts = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).formatToParts(janProbe);
    const jm = {};
    for (const p of janParts) jm[p.type] = p.value;
    let jHour = parseInt(jm.hour, 10);
    if (jHour === 24) jHour = 0;
    const janAsUTC = Date.UTC(
      parseInt(jm.year, 10), parseInt(jm.month, 10) - 1, parseInt(jm.day, 10),
      jHour, parseInt(jm.minute, 10), parseInt(jm.second, 10)
    );
    const janOffsetMinutes = Math.round((janAsUTC - janProbe.getTime()) / 60000);
    const isDST = offsetMinutes !== janOffsetMinutes;

    return { year, month, day, hour, minute, second, weekday, isDST, utcOffsetMinutes: offsetMinutes };
  }

  // ---------- DCF77 (77.5 kHz, Europe/Berlin local, 59 bits, bit59 = no pulse) ----------

  function encodeDCF77(date) {
    const t = civilTimeInZone(date, 'Europe/Berlin');
    const bits = new Array(59).fill(0); // index = second 0..58; second 59 has no pulse

    bits[0] = 0; // start of minute marker (always 0)
    // bits 1-14 civil warning / weather (unused) -> 0
    // bit 15 call bit / abnormal transmitter -> 0
    // bit 16 A1 DST announcement: 1 during the hour before a CET<->CEST change
    bits[16] = 0; // not computed (would need transition-lookup); safe default
    bits[17] = t.isDST ? 1 : 0; // Z1 = CEST in effect
    bits[18] = t.isDST ? 0 : 1; // Z2 = CET in effect
    bits[19] = 0; // A2 leap second announcement
    bits[20] = 1; // start of encoded time, always 1

    const minU = bcdDigit(t.minute % 10);
    const minT = bcdDigit(Math.floor(t.minute / 10));
    bits[21] = minU[0]; bits[22] = minU[1]; bits[23] = minU[2]; bits[24] = minU[3];
    bits[25] = minT[0]; bits[26] = minT[1]; bits[27] = minT[2];
    const minParityBits = [bits[21], bits[22], bits[23], bits[24], bits[25], bits[26], bits[27]];
    bits[28] = evenParity(minParityBits);

    const hrU = bcdDigit(t.hour % 10);
    const hrT = bcdDigit(Math.floor(t.hour / 10));
    bits[29] = hrU[0]; bits[30] = hrU[1]; bits[31] = hrU[2]; bits[32] = hrU[3];
    bits[33] = hrT[0]; bits[34] = hrT[1];
    const hrParityBits = [bits[29], bits[30], bits[31], bits[32], bits[33], bits[34]];
    bits[35] = evenParity(hrParityBits);

    const dayU = bcdDigit(t.day % 10);
    const dayT = bcdDigit(Math.floor(t.day / 10));
    bits[36] = dayU[0]; bits[37] = dayU[1]; bits[38] = dayU[2]; bits[39] = dayU[3];
    bits[40] = dayT[0]; bits[41] = dayT[1];

    const dow = t.weekday === 0 ? 7 : t.weekday; // DCF77: Monday=1..Sunday=7
    const dowBits = bcdDigit(dow);
    bits[42] = dowBits[0]; bits[43] = dowBits[1]; bits[44] = dowBits[2];

    const monU = bcdDigit(t.month % 10);
    const monT = bcdDigit(Math.floor(t.month / 10));
    bits[45] = monU[0]; bits[46] = monU[1]; bits[47] = monU[2]; bits[48] = monU[3];
    bits[49] = monT[0];

    const yy = t.year % 100;
    const yrU = bcdDigit(yy % 10);
    const yrT = bcdDigit(Math.floor(yy / 10));
    bits[50] = yrU[0]; bits[51] = yrU[1]; bits[52] = yrU[2]; bits[53] = yrU[3];
    bits[54] = yrT[0]; bits[55] = yrT[1]; bits[56] = yrT[2]; bits[57] = yrT[3];

    const dateParityBits = [
      bits[36], bits[37], bits[38], bits[39], bits[40], bits[41],
      bits[42], bits[43], bits[44],
      bits[45], bits[46], bits[47], bits[48], bits[49],
      bits[50], bits[51], bits[52], bits[53], bits[54], bits[55], bits[56], bits[57]
    ];
    bits[58] = evenParity(dateParityBits);

    // Build pulses: bit=0 -> 100ms low; bit=1 -> 200ms low; each followed by
    // high for the rest of the second. Second 59 (if present) has NO pulse
    // (this marks the top of the minute — DCF77 60-bit position simply isn't sent).
    const pulses = [];
    for (let s = 0; s < 59; s++) {
      const lowMs = bits[s] === 1 ? 200 : 100;
      pulses.push({ lowMs, highMs: 1000 - lowMs });
    }
    pulses.push({ lowMs: 0, highMs: 1000, isMinuteGap: true }); // second 59: no pulse at all

    return {
      name: 'DCF77', carrierHz: 77500, frameLengthSeconds: 60,
      civil: t, bits, pulses,
      summaryLine: `DCF77  ${pad2(t.day)}.${pad2(t.month)}.${t.year}  ${pad2(t.hour)}:${pad2(t.minute)}  ${t.isDST ? 'CEST' : 'CET'}`
    };
  }

  // ---------- MSF (60 kHz, Europe/London local, 2 bits/sec A,B) ----------

  function encodeMSF(date) {
    const t = civilTimeInZone(date, 'Europe/London');
    // A/B bit pairs, index = second 0..59
    const A = new Array(60).fill(0);
    const B = new Array(60).fill(0);

    // second 0 is the minute marker (500ms), handled specially in pulses.
    // seconds 1-16: DUT1 code -> leave at 0 (not simulating DUT1 telegraph)
    const yy = t.year % 100;
    const yrBits = bitsForWeights(yy, [80, 40, 20, 10, 8, 4, 2, 1]); // 17-24
    for (let i = 0; i < 8; i++) A[17 + i] = yrBits[i];

    const monBits = bitsForWeights(t.month, [10, 8, 4, 2, 1]); // 25-29
    for (let i = 0; i < 5; i++) A[25 + i] = monBits[i];

    const domBits = bitsForWeights(t.day, [20, 10, 8, 4, 2, 1]); // 30-35
    for (let i = 0; i < 6; i++) A[30 + i] = domBits[i];

    const dow = t.weekday; // MSF: 0=Sunday..6=Saturday, 3-bit weights 4,2,1
    const dowBits = bitsForWeights(dow, [4, 2, 1]); // 36-38
    for (let i = 0; i < 3; i++) A[36 + i] = dowBits[i];

    const hrBits = bitsForWeights(t.hour, [20, 10, 8, 4, 2, 1]); // 39-44
    for (let i = 0; i < 6; i++) A[39 + i] = hrBits[i];

    const minBits = bitsForWeights(t.minute, [40, 20, 10, 8, 4, 2, 1]); // 45-51
    for (let i = 0; i < 7; i++) A[45 + i] = minBits[i];

    // bit 52 unused
    // bit 53 (B): DST-imminent-change announcement -> not computed, 0
    // bits 54-57 (B): parity bits over date/time groups. For clock-setting
    // purposes most receivers primarily trust the A-bit fields + bit58(B);
    // we still compute correct even parity per published allocation:
    //   B54: parity over year (A17-24)
    //   B55: parity over month+day (A25-35)
    //   B56: parity over day-of-week (A36-38)
    //   B57: parity over hour+minute (A39-51)
    B[54] = evenParity(yrBits);
    B[55] = evenParity(monBits.concat(domBits));
    B[56] = evenParity(dowBits);
    B[57] = evenParity(hrBits.concat(minBits));
    B[58] = t.isDST ? 1 : 0; // summer time (BST) in effect

    const pulses = [];
    for (let s = 0; s < 60; s++) {
      if (s === 0) {
        pulses.push({ lowMs: 500, highMs: 500, isMinuteMarker: true });
        continue;
      }
      const a = A[s], b = B[s];
      if (a === 0 && b === 0) {
        pulses.push({ lowMs: 100, highMs: 900 });
      } else if (a === 1 && b === 0) {
        pulses.push({ lowMs: 200, highMs: 800 });
      } else if (a === 1 && b === 1) {
        pulses.push({ lowMs: 300, highMs: 700 });
      } else {
        // a===0 && b===1: low,high,low each 100ms then high 700ms
        pulses.push({
          lowMs: 300, highMs: 700,
          pattern: [
            { ms: 100, level: 'low' }, { ms: 100, level: 'high' }, { ms: 100, level: 'low' },
            { ms: 700, level: 'high' }
          ]
        });
      }
    }

    return {
      name: 'MSF', carrierHz: 60000, frameLengthSeconds: 60,
      civil: t, bits: { A, B }, pulses,
      summaryLine: `MSF  ${pad2(t.day)}.${pad2(t.month)}.${t.year}  ${pad2(t.hour)}:${pad2(t.minute)}  ${t.isDST ? 'BST' : 'GMT'}`
    };
  }

  // ---------- WWVB (60 kHz, UTC, 1 bit/sec, NIST SP432 Fig 2.6 layout) ----------

  function encodeWWVB(date) {
    const t = {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      second: date.getUTCSeconds(),
      weekday: date.getUTCDay()
    };
    const doy = dayOfYear(new Date(Date.UTC(t.year, t.month - 1, t.day)));
    const leap = isLeapYear(t.year) ? 1 : 0;

    // code[] holds a symbol per second: 0, 1, or 'M' (marker)
    const code = new Array(60).fill(0);
    const markerSecs = [0, 9, 19, 29, 39, 49, 59];
    for (const s of markerSecs) code[s] = 'M';

    const minBits = bitsForWeights(t.minute, [40, 20, 10, 0, 8, 4, 2, 1]); // secs 1-8
    for (let i = 0; i < 8; i++) code[1 + i] = minBits[i];

    const hrBits = bitsForWeights(t.hour, [0, 0, 20, 10, 0, 8, 4, 2, 1]); // secs 10-18
    for (let i = 0; i < 9; i++) code[10 + i] = hrBits[i];

    // day of year, secs 22-33 (bits 20,21 reserved/unused per NIST table)
    const doyBits = bitsForWeights(doy, [200, 100, 0, 80, 40, 20, 10, 0, 8, 4, 2, 1]); // secs 22-33
    for (let i = 0; i < 12; i++) code[22 + i] = doyBits[i];

    // secs 36-38: UT1 sign (+,-,+) — not simulating DUT1, leave 0
    // secs 40-43: UT1 correction magnitude — leave 0
    // Year is two independent BCD digits (tens 0-9, units 0-9), NOT one
    // greedy binary field — weight 10 means "1 ten", not "10 units".
    const yy = t.year % 100;
    const yrTensBits = bitsForWeights(Math.floor(yy / 10), [8, 4, 2, 1]); // secs 45-48, scaled x10 by position
    for (let i = 0; i < 4; i++) code[45 + i] = yrTensBits[i];
    const yrUnitsBits = bitsForWeights(yy % 10, [8, 4, 2, 1]); // secs 50-53
    for (let i = 0; i < 4; i++) code[50 + i] = yrUnitsBits[i];

    code[55] = leap; // leap year indicator
    code[56] = 0;    // leap second warning
    // US DST bits 57,58 — WWVB carries US DST status, not simulated here
    // (Canada/USA-specific; left at 0 = standard time / not applicable)
    code[57] = 0;
    code[58] = 0;

    const pulses = code.map((sym) => {
      if (sym === 'M') return { lowMs: 800, highMs: 200 };
      if (sym === 1) return { lowMs: 500, highMs: 500 };
      return { lowMs: 200, highMs: 800 };
    });

    return {
      name: 'WWVB', carrierHz: 60000, frameLengthSeconds: 60,
      civil: t, bits: code, pulses,
      summaryLine: `WWVB (UTC)  day ${doy}, ${t.year}  ${pad2(t.hour)}:${pad2(t.minute)}`
    };
  }

  // ---------- JJY (40/60 kHz, JST = UTC+9, no DST) ----------

  function encodeJJY(date) {
    const t = civilTimeInZone(date, 'Asia/Tokyo');
    const doy = dayOfYear(new Date(Date.UTC(t.year, t.month - 1, t.day)));

    const code = new Array(60).fill(0);
    const markerSecs = [0, 9, 19, 29, 39, 49, 59];
    for (const s of markerSecs) code[s] = 'M';

    const minBits = bitsForWeights(t.minute, [40, 20, 10, 0, 8, 4, 2, 1]); // secs 1-8
    for (let i = 0; i < 8; i++) code[1 + i] = minBits[i];

    const hrBits = bitsForWeights(t.hour, [0, 0, 20, 10, 0, 8, 4, 2, 1]); // secs 10-18
    for (let i = 0; i < 9; i++) code[10 + i] = hrBits[i];

    // day of year, secs 20-28 then 30-33 (marker at 29 splits the field)
    const doyBits = bitsForWeights(doy, [200, 100, 0, 80, 40, 20, 10, 0, 8]); // secs 20-28
    for (let i = 0; i < 9; i++) code[20 + i] = doyBits[i];
    const doyBits2 = bitsForWeights(doy % 8, [4, 2, 1]); // secs 30-32 (low 3 bits continuation)
    // NOTE: the day-of-year low nibble spans the marker at 29; use full
    // weights against remaining value for correctness:
    let doyRemainder = doy - (doyBits.reduce((acc, b, i) => acc + b * [200,100,0,80,40,20,10,0,8][i], 0));
    const lowBits = bitsForWeights(doyRemainder, [4, 2, 1]);
    for (let i = 0; i < 3; i++) code[30 + i] = lowBits[i];

    // secs 36-37: parity bits (PA1 = hour parity, PA2 = minute parity)
    code[36] = evenParity(hrBits);
    code[37] = evenParity(minBits);

    // sec 38: reserved (0); sec 40: SU1/DST flag (Japan has no DST) -> 0
    code[40] = 0;

    const yrBits = bitsForWeights(t.year % 100, [80, 40, 20, 10, 8, 4, 2, 1]); // secs 41-48
    for (let i = 0; i < 8; i++) code[41 + i] = yrBits[i];

    const dowBits = bitsForWeights(t.weekday, [4, 2, 1]); // secs 50-52 (0=Sunday)
    for (let i = 0; i < 3; i++) code[50 + i] = dowBits[i];

    // secs 53-54: leap second warning -> 0

    // JJY's envelope is HIGH-first (opposite of DCF77/MSF/WWVB/BPC, which
    // are LOW-first). Pulses are expressed with an explicit first/second
    // segment so the renderer doesn't need a separate "inverted" code path.
    const pulses = code.map((sym) => {
      if (sym === 'M') return { firstMs: 200, firstLevel: 'high', secondMs: 800, secondLevel: 'low' };
      if (sym === 1) return { firstMs: 500, firstLevel: 'high', secondMs: 500, secondLevel: 'low' };
      return { firstMs: 800, firstLevel: 'high', secondMs: 200, secondLevel: 'low' };
    });

    return {
      name: 'JJY', carrierHz: 40000, frameLengthSeconds: 60,
      civil: t, bits: code, pulses, inverted: true,
      summaryLine: `JJY (JST)  ${pad2(t.day)}.${pad2(t.month)}.${t.year}  ${pad2(t.hour)}:${pad2(t.minute)}  day ${doy}`
    };
  }

  // ---------- BPC (68.5 kHz, CST China = UTC+8, no DST, 20s frame, 2 bits/sec) ----------

  // BPC's format is not officially published; the layout below follows the
  // frame table sourced from Wikipedia's "BPC (time signal)" article, which
  // documents seconds 00-19 field-by-field (start marker, second-of-minute
  // rounded to 20s, hour, minute, AM/PM + parity P1, day, month, year, day
  // of week + parity P2). Minute and hour fields there are given as plain
  // 2-bit-per-second binary words (not classic 4-bit BCD nibbles), which is
  // reproduced faithfully here.
  function encodeBPC(date) {
    const t = civilTimeInZone(date, 'Asia/Shanghai');

    // BPC's 20-bit-pair frame repeats every 20s and describes the time at
    // the start of that block; round the current second down to the
    // nearest 0/20/40 boundary.
    const blockSecond = Math.floor(t.second / 20) * 20; // 0, 20, or 40

    const pair = (msb, lsb) => [msb, lsb];
    const words = {}; // second index (1-19) -> [MSbit, LSbit]

    // sec 1: seconds-of-minute rounded to 20s, weights 40/20
    words[1] = pair(blockSecond === 40 ? 1 : 0, blockSecond === 20 ? 1 : 0);

    words[2] = pair(0, 0); // unused

    // secs 2-4: hour (00-23) as 5-bit binary split across three seconds.
    // A real captured BPC sample (hour=7, Wikipedia footnote 5) confirms
    // weights (8,4) at sec 3 and (2,1) at sec 4, but 4 bits alone cap out
    // at 15 and can't reach 23, so a 16-weight bit must live somewhere —
    // sec 2 (documented as "unused" in the public table, always 0 in every
    // available sample because those samples happened to be single-digit
    // hours) is the only remaining slot before the confirmed nibble.
    const hrBits = bitsForWeights(t.hour, [16, 0, 8, 4, 2, 1]);
    words[2] = pair(hrBits[0], hrBits[1]);
    words[3] = pair(hrBits[2], hrBits[3]);
    words[4] = pair(hrBits[4], hrBits[5]);

    // secs 5-7: minute (00-59), 6-bit binary split across three seconds
    const minBits = bitsForWeights(t.minute, [32, 16, 8, 4, 2, 1]);
    words[5] = pair(minBits[0], minBits[1]);
    words[6] = pair(minBits[2], minBits[3]);
    words[7] = pair(minBits[4], minBits[5]);

    words[8] = pair(0, 0); // unused

    words[9] = pair(0, 0); // unused (reserved in published table)

    // sec 10 = P1: MSbit = AM(0)/PM(1), LSbit = even parity over secs 1-9
    const isPM = t.hour >= 12 ? 1 : 0;
    const parity1Bits = [
      words[1][0], words[1][1], words[3][0], words[3][1], words[4][0], words[4][1],
      words[5][0], words[5][1], words[6][0], words[6][1], words[7][0], words[7][1]
    ];
    words[10] = pair(isPM, evenParity(parity1Bits));

    // secs 11-13: day of month (01-31) as 6-bit binary split across three
    // seconds (weights 32,16,8,4,2,1 — the same width pattern confirmed
    // for the minute field against a real captured BPC sample; a 31-max
    // value needs 5-6 bits, which the 4-bit span originally tried here
    // could not represent, so this field spans one more second than a
    // literal reading of the public bit table suggested).
    const domBits = bitsForWeights(t.day, [32, 16, 8, 4, 2, 1]);
    words[11] = pair(domBits[0], domBits[1]);
    words[12] = pair(domBits[2], domBits[3]);
    words[13] = pair(domBits[4], domBits[5]);

    // secs 14-15: month (01-12), 4-bit binary split across two seconds
    const monBits = bitsForWeights(t.month, [8, 4, 2, 1]);
    words[14] = pair(monBits[0], monBits[1]);
    words[15] = pair(monBits[2], monBits[3]);

    // secs 16-18: year within century (00-99), 6-bit binary split across three seconds
    const yrBits = bitsForWeights(t.year % 100, [32, 16, 8, 4, 2, 1]);
    words[16] = pair(yrBits[0], yrBits[1]);
    words[17] = pair(yrBits[2], yrBits[3]);
    words[18] = pair(yrBits[4], yrBits[5]);

    // sec 19 = P2: MSbit = day-of-week bit "64" weight (per published table),
    // LSbit = even parity over secs 11-18
    const dow = t.weekday === 0 ? 7 : t.weekday; // 1=Monday..7=Sunday
    const parity2Bits = [
      words[11][0], words[11][1], words[12][0], words[12][1], words[13][0], words[13][1],
      words[14][0], words[14][1], words[15][0], words[15][1],
      words[16][0], words[16][1], words[17][0], words[17][1], words[18][0], words[18][1]
    ];
    words[19] = pair(dow >= 7 ? 1 : 0, evenParity(parity2Bits));

    const lowMsTable = [100, 200, 300, 400]; // index = (MSbit<<1)|LSbit
    const pulses = [];
    for (let s = 0; s < 20; s++) {
      if (s === 0) {
        pulses.push({ lowMs: 0, highMs: 1000, isMarker: true }); // no reduction = start-of-frame marker
        continue;
      }
      const w = words[s] || [0, 0];
      const lowMs = lowMsTable[(w[0] << 1) | w[1]];
      pulses.push({ lowMs, highMs: 1000 - lowMs });
    }

    return {
      name: 'BPC', carrierHz: 68500, frameLengthSeconds: 20,
      civil: t, bits: words, pulses,
      summaryLine: `BPC (CST)  ${pad2(t.day)}.${pad2(t.month)}.${t.year}  ${pad2(t.hour)}:${pad2(t.minute)}  (20s frame)`
    };
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  return {
    encodeDCF77,
    encodeMSF,
    encodeWWVB,
    encodeJJY,
    encodeBPC,
    _internal: { civilTimeInZone, dayOfYear, isLeapYear, bitsForWeights, bcdDigit }
  };
});
