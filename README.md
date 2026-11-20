[![make.fun · news-image-20261120](https://make.fun/badge/news-image-20261120.svg)](https://make.fun/bounty/news-image-20261120?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261120)
[![rank](https://make.fun/badge/news-image-20261120/arianda17/news-image-20261120-v6/rank.svg)](https://make.fun/bounty/news-image-20261120/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261120)
[![reward](https://make.fun/badge/news-image-20261120/arianda17/news-image-20261120-v6/reward.svg)](https://make.fun/bounty/news-image-20261120?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261120)

# The World Today — 36 Stories: Friday 20 November 2026

A one-image summary of Friday 20 November 2026's world news, drawn
programmatically (Node 22, standard library only, no network, fully
deterministic). 36 verified stories: 13 featured + 23 one-liners.

## Layout (1024x1024)

| Band | Content |
| --- | --- |
| Masthead 0–82 | "20 NOVEMBER 2026", "FRIDAY - ONE DAY, ONE PICTURE", "THE WORLD TODAY - 36 STORIES - ONE DAY" |
| Region tabs 82–104 | ASIA 12 · EUROPE 6 · MIDDLE EAST 2 · AMERICAS 9 · AFRICA 2 · GLOBAL 5 (= 36) |
| UTC timeline 104–142 | "THE DAY IN UTC" + 6 verified anchors (see below) |
| Lead strip 142–298 | Two large cards: (1) Trump puts Iran war call off to 2027, (2) Trump, Xi, Putin: 4-point declaration |
| Numbers strip 298–346 | 8 boxes: -1,101 DOW POINTS · -2.0% S&P 500 · -2.3% NASDAQ · 300,000 EVACUATED · 423 RESCUE TEAMS · 1 LIGHT-DAY VOYAGER 1 · 80 MINUTES SUMMIT · 118 PHILLIPS |
| Medium grid 346–560 | 11 cards (4 + 4 + 3): Wall Street, COP31, Akvan, Voyager 1, Europe-Russia talks, Anthropic, Hayabusa2, GTA VI, Pete Rose, Modi, Phillips |
| World map 560–646 | Schematic continents, 8 pins, 8 city labels in open sea with red leader lines |
| Also on 646–948 | "ALSO ON FRIDAY 20 NOVEMBER", 23 one-liners numbered 14–36, region dot per item |
| Date check 948–986 | "NOT TODAY" strip (see below) |
| Footer 986–1024 | SOURCES: REUTERS AP BBC WSJ THE HINDU IMD NASA · ALL STORIES VERIFIED AGAINST NAMED SOURCES · 20 NOVEMBER 2026 |

Every story is numbered 1–36; map pins are numbered to match (Riyadh
carries a plain dot — no featured story is based there).

## The 36 stories

Featured (1–13): 1 Trump puts Iran war call off to 2027 (REUTERS) ·
2 Trilateral 4-point declaration (CFR) · 3 Dow slides 1,101 (WSJ) ·
4 COP31 closing day, no deal yet (THE HINDU) · 5 Cyclone Akvan hits
Odisha (THE HINDU / IMD) · 6 Voyager 1 reaches one light-day (BBC) ·
7 Europe open to Russia talks (BBC) · 8 Anthropic $1.27T at close
(BBX) · 9 Hayabusa2 engine fault (SPACE) · 10 GTA VI sales pass $1.8B
(MEZHA) · 11 Trump pardons Pete Rose (BBC) · 12 Modi: where are the
hires? (FICCI) · 13 Phillips 118 as NZ pass 250 (REUTERS).

One-liners (14–36): 14 Yunus home fire · 15 Hong Kong Open badminton ·
16 Rahul Gandhi rejects boycott · 17 US summonses to Doval, Goel ·
18 Pakistan minister to Delhi (SCO) · 19 California targets Nvidia ·
20 Canada embraces AI data centres · 21 Taiz siege voices ·
22 US measles comeback · 23 Fiona the hippo dies · 24 Cumin sodas
challenge cola · 25 World Children's Day · 26 Joburg: ANC nears deal
· 27 EU-UK summit opens · 28 NATO assembly 72nd session ·
29 Bird-flu vaccine (India) · 30 Youth strike Europe · 31 Asian rout,
worst week since 2020 · 32 Fridge hack shield (UK) · 33 Meta climate
U-turn · 34 Bukele third term · 35 Senegal boat capsize ·
36 Wild beat Flames 4-1.

Region counts (recounted from this list): ASIA 12, EUROPE 6,
MIDDLE EAST 2, AMERICAS 9, AFRICA 2, GLOBAL 5 = 36.

## The day in UTC (verified anchors only)

~00:02 UTC BBC reports UK fridge-hacking shield · ~00:23 UTC Reuters
Phillips-century report · 02:00–03:00 UTC Cyclone Akvan crosses coast
near Gopalpur (IMD) · 09:30 UTC EU-UK summit opens in Brussels ·
12:00 UTC Youth Strike London rally · 21:00 UTC COP31 final text due.

## Date check

NOT TODAY: ICJ Myanmar ruling 19 Nov. Fiji disaster 18 Nov. KAFD
strike 19 Nov. Hormuz mine claims unconfirmed. US-Venezuela deal
19 Nov. Summit met 19 Nov. Voyager 1 milestone 18 Nov, announced
19 Nov. Hayabusa2 retargeting announced 17 Nov.

Cut items (10 TBD candidates) appear nowhere as 20 Nov news: EU
methane-rules delay, US jobless claims, crude-oil fall, Harimau Shakti,
India electronics exports, Philippines-Chile deal, Musk Philippines
projects, Amur falcons, Bayern-Koln 3-0, Argentina-Australia U17.
The verified spare (Blues 5-2 Penguins) is also omitted; 36 is the
target. Anthropic is printed only as "$1.27T AT CLOSE" ($1.5T appears
nowhere). Akvan uses 300,000 evacuated / 423 rescue teams.

## Technique

- Fresh 8x12 vector-stroke glyph set (A-Z, a-z, 0-9, punctuation),
  drawn from stroke polylines rasterised to coverage masks.
- 3x supersampled framebuffer (3072x3072) + box-filter downsample to
  1024x1024; glyph stamps bilinearly sampled at a 1/3-output-pixel
  sub-pixel offset for anti-aliasing.
- Kerning: comma and period before a digit advance 4.5 units (not 8),
  so "-1,101" reads as one number.
- No network, no `Date.now`, no `Math.random`: two runs produce
  byte-identical output.

## Build

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
# writes out/entry.png (1024x1024 PNG, under 1 MiB)
```

Font test sheet (pangram + full charset): `FONT_TEST=1
MAKEFUN_OUTPUT_DIR=out node main.ts` writes `out/font-test.png`.

## Verification (this build)

- Rendered twice with the grading node; sha256 byte-identical.
- Filled fraction 79.8% (target 75–85%).
- Hard horizontal edges 0.96% (luminance step > 150 between adjacent
  pixels; v5's band was ~1–3.5% by its own measure).
- Map labels verified at runtime: every label-box corner and centre
  is sea (point-in-polygon against the exact continent geometry); no
  two labels overlap.
- Full render + 2x crops of every zone inspected visually; all 36
  story numbers present and sequential; footer is 3 clean rows; no
  illustration touches any headline or body text.
- 300px-wide downscale checked: every text tier reads.
