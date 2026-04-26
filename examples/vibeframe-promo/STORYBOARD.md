# Storyboard — VibeFrame promo

**Format:** 1920×1080
**Audio:** Silent (no narration in this fixture — add later via `vibe scene add --narration` if desired)
**Style basis:** DESIGN.md (Swiss Pulse — black canvas, electric-blue accent, Inter Bold)

## Beat hook — Hook (0–3s)

### Concept

Cold open. The frame is empty black for 0.3s — silence. Then the
headline SLAMS in centre-frame: "Type a YAML." The viewer sees nothing
else. The brand identity asserts itself with restraint.

### Visual

- Background: solid `#0A0A0F`. Nothing else.
- Headline: "Type a YAML." centred, Inter Bold 120px, `#F5F5F7`. Snaps in via `expo.out` at t=0.3s.
- Subhead label "ONE COMMAND" appears below the headline at t=1.0s, Inter Regular 32px, all-caps, `letter-spacing: 0.15em`, colour `#0066FF`. Fades up via `power3.out` over 0.4s.
- Empty negative space above and below. Text occupies the centre 40% of the frame vertically.

### Animations

- 0.3s: headline `gsap.from(headline, { y: 60, opacity: 0, duration: 0.5, ease: "expo.out" })`
- 1.0s: subhead `gsap.from(subhead, { y: 20, opacity: 0, duration: 0.4, ease: "power3.out" })`
- No exit animations.

### Beat duration

3 seconds.

## Beat claim — Get a video (3–6s)

### Concept

The claim. Single bold line: "Get a video." Same restraint, same
typography. The pair "Type a YAML / Get a video" reads as the
product's contract — input + output, nothing in between.

### Visual

- Background: solid `#0A0A0F`. Nothing else.
- Headline: "Get a video." centred, Inter Bold 120px, `#F5F5F7`. Snaps in via `expo.out` at t=0.3s.
- Subhead label "13 AI PROVIDERS" below the headline at t=0.9s, Inter Regular 32px, all-caps, letter-spacing 0.15em, colour `#0066FF`. Fades up via `power3.out` over 0.4s.

### Animations

- 0.3s: headline `gsap.from(headline, { y: 60, opacity: 0, duration: 0.5, ease: "expo.out" })`
- 0.9s: subhead `gsap.from(subhead, { y: 20, opacity: 0, duration: 0.4, ease: "power3.out" })`

### Beat duration

3 seconds.

## Beat close — Close (6–9s)

### Concept

The close. The brand mark + a single grounding fact: "Open source.
MIT." Logo-equivalent treatment with Inter Bold 96px, the smaller of
the three to feel like a wordmark rather than a headline.

### Visual

- Background: solid `#0A0A0F`. Nothing else.
- Wordmark: "VibeFrame" at top centre, Inter Bold 96px, `#F5F5F7`. Snaps in via `expo.out` at t=0.3s.
- Subhead "Open source · MIT" centred below the wordmark at t=0.9s, Inter Regular 32px, all-caps, letter-spacing 0.15em, colour `#0066FF`. Fades up via `power3.out` over 0.4s.
- Single thin electric-blue underline under "VibeFrame", `#0066FF`, 2px tall, drawn left-to-right at t=1.4s via `power3.out` 0.5s.

### Animations

- 0.3s: wordmark `gsap.from(headline, { y: 50, opacity: 0, duration: 0.5, ease: "expo.out" })`
- 0.9s: subhead `gsap.from(subhead, { y: 20, opacity: 0, duration: 0.4, ease: "power3.out" })`
- 1.4s: underline `gsap.from(underline, { scaleX: 0, transformOrigin: "left center", duration: 0.5, ease: "power3.out" })`
- This is the final beat — exit-fade is allowed at t=2.4s if desired.

### Beat duration

3 seconds.
