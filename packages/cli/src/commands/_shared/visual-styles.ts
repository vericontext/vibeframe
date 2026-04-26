/**
 * @module _shared/visual-styles
 *
 * Eight named visual identities used to seed `DESIGN.md` when scaffolding a
 * scene project. The structured data below distils the rules that
 * Hyperframes' `hyperframes` skill encodes in
 * `skills/hyperframes/visual-styles.md` (Apache 2.0). VibeFrame vendors the
 * data — not the prose — so a project scaffolded without an active agent
 * still gets a credible DESIGN.md as a starting point.
 *
 * The agent-driven path (`/hyperframes` skill loaded in Claude Code) remains
 * the canonical way to author final compositions; this module just ensures
 * the visual contract exists in the project before any HTML is written.
 *
 * Source-of-truth attribution: HeyGen Hyperframes — https://hyperframes.heygen.com
 * License: Apache 2.0 (see NOTICE)
 */

/** One named visual identity. Designed to round-trip into DESIGN.md. */
export interface VisualStyle {
  /** Display name, e.g. "Swiss Pulse". */
  name: string;
  /** URL/CLI-friendly slug, e.g. "swiss-pulse". */
  slug: string;
  /** Designer or movement the style references. */
  designer: string;
  /** One-line mood, e.g. "Clinical, precise". */
  mood: string;
  /** Content categories the style works best for. */
  bestFor: string;
  /** 2–3 hex colours that anchor the palette. */
  palette: string[];
  /** Free-form palette description (warm/cold, primary/accent). */
  paletteNotes: string;
  /** Typography rules — family, weights, role per weight. */
  typography: string;
  /** Composition rules — grid, spacing, framing. */
  composition: string;
  /** Motion rules — speed, easing, character. */
  motion: string;
  /** Hyperframes shader name(s) that match the energy. */
  transition: string;
  /** GSAP signature — easing functions and feel. */
  gsapSignature: string;
  /** 3 anti-patterns to avoid for this style. */
  avoid: string[];
}

const STYLES: VisualStyle[] = [
  {
    name: "Swiss Pulse",
    slug: "swiss-pulse",
    designer: "Josef Müller-Brockmann",
    mood: "Clinical, precise",
    bestFor: "SaaS dashboards, developer tools, APIs, metrics",
    palette: ["#1a1a1a", "#ffffff", "#0066FF"],
    paletteNotes:
      "Black, white, ONE accent — electric blue (#0066FF) or amber (#FFB300). Never both accents at once.",
    typography:
      "Helvetica or Inter Bold for headlines, Regular for labels. Numbers dominate at 80–120px.",
    composition:
      "Grid-locked. Every element snaps to an invisible 12-column grid. Hard cuts only — no decorative transitions.",
    motion:
      "Animated counters count up from 0. Entries are fast and snap into place. Nothing floats.",
    transition: "Cinematic Zoom or SDF Iris (precise, geometric)",
    gsapSignature: "expo.out, power4.out — fast arrivals, hard stops",
    avoid: [
      "Decorative transitions (fades, dissolves) — use hard cuts",
      "Two accent colours competing in one frame",
      "Off-grid placement or floating elements",
    ],
  },
  {
    name: "Velvet Standard",
    slug: "velvet-standard",
    designer: "Massimo Vignelli",
    mood: "Premium, timeless",
    bestFor: "Luxury products, enterprise software, keynotes, investor decks",
    palette: ["#000000", "#ffffff", "#1a237e"],
    paletteNotes:
      "Black, white, ONE rich accent — deep navy (#1a237e) or gold (#c9a84c).",
    typography:
      "Thin sans-serif, ALL CAPS, wide letter-spacing (0.15em+). Sequential reveals only.",
    composition:
      "Generous negative space. Symmetrical, centered, architectural precision. Nothing busy.",
    motion:
      "Slow, deliberate. Sequential reveals with long holds. No frantic motion.",
    transition: "Cross-Warp Morph (elegant, organic flow between scenes)",
    gsapSignature: "sine.inOut, power1 — nothing snaps, everything glides",
    avoid: [
      "Tight letter-spacing — kills the premium register",
      "Bouncy or elastic easings — too playful",
      "Multiple elements arriving at once — break sequence",
    ],
  },
  {
    name: "Deconstructed",
    slug: "deconstructed",
    designer: "Neville Brody",
    mood: "Industrial, raw",
    bestFor: "Tech news, developer launches, security products, punk-energy reveals",
    palette: ["#1a1a1a", "#D4501E", "#f0f0f0"],
    paletteNotes:
      "Dark grey (#1a1a1a), rust orange (#D4501E), raw white (#f0f0f0).",
    typography:
      "Type at angles, overlapping edges, escaping frames. Bold industrial weight.",
    composition:
      "Gritty textures — scan-line effects, glitch artifacts baked into the design.",
    motion:
      "Text SLAMS and SHATTERS. Letters scramble then snap to final position.",
    transition: "Glitch shader or Whip Pan (breaks the rules, feels aggressive)",
    gsapSignature: "back.out(2.5), steps(8), elastic.out(1.2, 0.4) — intentional irregularity",
    avoid: [
      "Polished, centered compositions — must feel raw",
      "Smooth fades — use glitch / scramble entries",
      "Soft easings — every motion lands hard",
    ],
  },
  {
    name: "Maximalist Type",
    slug: "maximalist-type",
    designer: "Paula Scher",
    mood: "Loud, kinetic",
    bestFor: "Big product launches, milestone announcements, high-energy hype videos",
    palette: ["#E63946", "#FFD60A", "#000000", "#ffffff"],
    paletteNotes:
      "Bold saturated: red (#E63946), yellow (#FFD60A), black, white — maximum contrast.",
    typography:
      "Text IS the visual. Overlapping type layers at different scales and angles, filling 50–80% of frame.",
    composition:
      "Text layered OVER footage — never empty backgrounds. 2–3 second rapid-fire scenes.",
    motion:
      "Everything is kinetic — slamming, sliding, scaling. No static moments.",
    transition: "Ridged Burn (explosive, dramatic, impossible to ignore)",
    gsapSignature: "expo.out, back.out(1.8) — fast arrivals, hard stops",
    avoid: [
      "Static moments — every frame must move",
      "Empty backgrounds — text and footage must layer",
      "Single typeface at a single size — must be layered",
    ],
  },
  {
    name: "Data Drift",
    slug: "data-drift",
    designer: "Refik Anadol",
    mood: "Futuristic, immersive",
    bestFor: "AI products, ML platforms, data companies, speculative tech",
    palette: ["#0a0a0a", "#7c3aed", "#06b6d4"],
    paletteNotes:
      "Iridescent — deep black (#0a0a0a), electric purple (#7c3aed), cyan (#06b6d4).",
    typography:
      "Thin futuristic sans-serif — floating, weightless, minimal text.",
    composition:
      "Fluid morphing compositions. Extreme scale shifts (micro → macro). Particles coalesce into numbers.",
    motion:
      "Light traces data paths through the frame. Smooth, continuous, organic — nothing hard.",
    transition: "Gravitational Lens or Domain Warp (otherworldly distortion)",
    gsapSignature: "sine.inOut, power2.out — smooth, continuous, organic",
    avoid: [
      "Hard cuts — break the immersion",
      "Heavy/bold typography — too grounded",
      "Static compositions — must feel like flow",
    ],
  },
  {
    name: "Soft Signal",
    slug: "soft-signal",
    designer: "Stefan Sagmeister",
    mood: "Intimate, warm",
    bestFor: "Wellness brands, personal stories, lifestyle products, human-centered apps",
    palette: ["#F5A623", "#FFF8EC", "#C4A3A3", "#8FAF8C"],
    paletteNotes:
      "Warm amber (#F5A623), cream (#FFF8EC), dusty rose (#C4A3A3), sage green (#8FAF8C).",
    typography:
      "Handwritten-style or humanist serif fonts. Personal, lowercase, delicate.",
    composition:
      "Close-up framing feel — single element fills the frame. Nothing feels corporate.",
    motion:
      "Slow drifts and floats, never snaps. Soft organic motion throughout.",
    transition: "Thermal Distortion (warm, flowing, like heat shimmer)",
    gsapSignature: "sine.inOut, power1.inOut — everything breathes",
    avoid: [
      "Sharp geometric layouts — break the warmth",
      "Hard easings or snaps — too clinical",
      "Cool tones (blue/green-blue) without warm balance",
    ],
  },
  {
    name: "Folk Frequency",
    slug: "folk-frequency",
    designer: "Eduardo Terrazas",
    mood: "Cultural, vivid",
    bestFor: "Consumer apps, food platforms, community products, festive launches",
    palette: ["#FF1493", "#0047AB", "#FFE000", "#009B77"],
    paletteNotes:
      "Vivid folk: hot pink (#FF1493), cobalt blue (#0047AB), sun yellow (#FFE000), emerald (#009B77).",
    typography:
      "Bold warm rounded type. Every frame feels handcrafted.",
    composition:
      "Pattern and repetition — folk art rhythm and density. Layered compositions with rich visual texture.",
    motion:
      "Colorful motion — elements bounce, pop, and spin into place with joy.",
    transition: "Swirl Vortex or Ripple Waves (hypnotic, celebratory)",
    gsapSignature: "back.out(1.6), elastic.out(1, 0.5) — overshoots feel intentional",
    avoid: [
      "Muted or monochrome palettes — kill the celebration",
      "Pure flat / minimal compositions — must feel layered",
      "Linear easings — motion should feel joyful",
    ],
  },
  {
    name: "Shadow Cut",
    slug: "shadow-cut",
    designer: "Hans Hillmann",
    mood: "Dark, cinematic",
    bestFor: "Security products, dramatic reveals, investigative content, intense launches",
    palette: ["#0a0a0a", "#3a3a3a", "#ffffff", "#C1121F"],
    paletteNotes:
      "Near-monochrome — deep blacks (#0a0a0a), cold greys (#3a3a3a), stark white + ONE accent (blood red #C1121F or toxic green #39FF14).",
    typography:
      "Sharp angular text like film noir title cards. Heavy contrast, no softness.",
    composition:
      "Heavy shadow — elements emerge from darkness. The reveal IS the narrative.",
    motion:
      "Slow creeping push-ins, dramatic scale reveals. Silence before the hit matters.",
    transition: "Domain Warp (dissolves reality before revealing the next scene)",
    gsapSignature: "power4.in for exits, power3.out for dramatic reveals — pause before the hit",
    avoid: [
      "Bright or saturated palettes — kill the cinematic mood",
      "Bouncy easings — break the tension",
      "Quick cuts — let the reveal breathe",
    ],
  },
];

/** All vendored styles in display order. */
export function listVisualStyles(): readonly VisualStyle[] {
  return STYLES;
}

/**
 * Find a style by name (case-insensitive) or slug. Returns undefined if no
 * match. Caller is responsible for surfacing a usage error.
 */
export function getVisualStyle(query: string): VisualStyle | undefined {
  const q = query.trim().toLowerCase();
  return STYLES.find(
    (s) => s.name.toLowerCase() === q || s.slug === q,
  );
}

/** Comma-joined list of valid `--visual-style` argument values, for help/error text. */
export function visualStyleNames(): string {
  return STYLES.map((s) => `"${s.name}"`).join(", ");
}
