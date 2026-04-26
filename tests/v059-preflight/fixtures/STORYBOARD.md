# Storyboard — VibeFrame promo

**Format:** 1920×1080
**Audio:** Kokoro voiceover, monotone confident delivery
**Style basis:** DESIGN.md (Swiss Pulse — black canvas, electric-blue accent, Inter Bold)

## Beat 1 — Hook (0–3s)

### Concept

Cold open. The frame is empty black for 0.3s — silence. Then the headline SLAMS in centre-frame: "Type a YAML." The viewer sees nothing else. The brand identity asserts itself with restraint.

### VO cue

> "Type a YAML."

(narration delivered confidently, single sentence, no music)

### Visual

- Background: solid `#0A0A0F`. Nothing else.
- Headline: "Type a YAML." centred, Inter Bold 120px, `#F5F5F7`. Snaps in via `expo.out` at t=0.3s. Duration 0.5s.
- Subhead label "ONE COMMAND" appears below the headline at t=1.0s, Inter Regular 32px, all-caps, letter-spacing 0.15em, colour `#0066FF`. Fades up via `power3.out` over 0.4s.
- Empty negative space above and below. Text occupies the centre 40% of the frame vertically.

### Animations

- 0.3s: headline `gsap.from(headline, { y: 60, opacity: 0, duration: 0.5, ease: "expo.out" })`
- 1.0s: subhead `gsap.from(subhead, { y: 20, opacity: 0, duration: 0.4, ease: "power3.out" })`
- No exit animations. Hard cut to Beat 2 at 3.0s.

### Assets

None (pure typography).

### Beat duration

3 seconds (`data-duration="3"`).
