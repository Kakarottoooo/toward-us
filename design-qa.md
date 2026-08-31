# Toward Us / 彼此 Design QA

## Evidence

- Source visual truth: `public/assets/brand/approved-visual-reference.png`
- Normalized source: `qa/source-home-393x852.png`
- Browser-rendered implementation: `qa/implementation-home-393x852.png`
- Full browser capture: `qa/implementation-full-final-1400x1200.png`
- Full-view comparison: `qa/comparison-home-side-by-side.png`
- Focused bottom-region comparison: `qa/comparison-home-bottom-focus.png`
- Additional rendered flow evidence: `qa/implementation-analysis-browser.png`
- Browser viewport: 1400 x 1200 CSS px
- App screen: 393 x 852 CSS px at scale 1
- Source pixels: 852 x 1856, normalized to 393 x 852 with high-quality bicubic resampling
- Implementation pixels: 393 x 852, captured from the visible device screen at device scale factor 1
- State: iPhone, Chinese, home screen; additional evidence covers shared-analysis state

## Required fidelity surfaces

- Fonts and typography: the display statement uses the closest locally available Chinese Song-style serif stack; UI copy uses the product sans stack. Optical weight, vertical rhythm, punctuation, hierarchy, and bilingual wrapping were checked. The live runtime status bar intentionally uses the protected platform font.
- Spacing and layout rhythm: the central statement, red/blue column proportions, wordmark, CTA width, CTA height, and footer rhythm align with the normalized source. The protected live status bar and home indicator add platform chrome that the poster source did not include.
- Colors and visual tokens: warm ivory, vermilion, ultramarine, ink, and muted-text tokens match the selected direction. No CSS gradients replace source art.
- Image quality and asset fidelity: the textured columns and split CTA are real raster assets derived through ImageGen from the approved reference. No handmade SVG, CSS drawing, emoji, or placeholder substitutes visible source art. Phosphor supplies standard interface icons.
- Copy and content: the approved Chinese statement, Toward Us / 彼此 wordmark, language control, start label, and footer line are preserved. English is a functional alternate language, not baked into the image.

## Comparison history

### Pass 1 — blocked

- [P2] The two headline clauses had too much vertical separation and made the statement visibly taller than the source.
- [P2] The wordmark and CTA sat too high; the CTA was wider and taller than the source.
- [P2] The CTA used a straight code-native color split instead of the approved diagonal red/blue junction.

Fixes made:

- Unified the Chinese statement into one live vertical heading, tightened letter spacing, and reduced the pause-mark gap.
- Moved the wordmark and action group to the source-aligned baseline; set the CTA to 283 x 58 CSS px.
- Generated and fitted a transparent, text-free diagonal split CTA asset while keeping live, accessible button text and icon controls.

### Pass 2 — passed

- Post-fix evidence: `qa/comparison-home-side-by-side.png` and `qa/comparison-home-bottom-focus.png`.
- No actionable P0, P1, or P2 visual differences remain.
- Expected difference: the implementation retains the mobile template's live iPhone status bar, rounded screen corners, and home indicator. These are protected runtime chrome, not app-owned design drift.

## Browser and interaction verification

- Opened the local app in the Codex in-app browser.
- Tested Chinese-to-English-to-Chinese switching.
- Tested Start → setup → create room → room.
- Tested text entry, send, persisted message rendering, and server-sent room updates.
- Tested Invite AI → private feedback → shared feedback with a live OpenAI response.
- Tested the two-speaker audio endpoint separately with synthetic two-voice audio: two transcript segments, two distinct speakers, raw-audio persistence reported as false.
- Microphone permission was not accepted during automated browser QA; the user-gesture permission prompt remains a device-level acceptance check.
- Checked fresh browser console warnings and errors after the final render: none.

## Residual P3 polish

- The exact Song typeface from the raster reference is not embedded; rendering uses the closest installed system Song-style serif.
- The protected iPhone chrome changes the perceived top and bottom whitespace compared with the standalone poster source.

## Private Beta extension — passed

- Accepted source: `public/assets/brand/approved-visual-reference.png`.
- Extension concept: `qa/beta-auth-invite-history-concept.png`.
- Native implementation evidence: `qa/beta-login-implementation.png`, `qa/beta-dashboard-implementation.png`, `qa/beta-history-implementation.png`, and `qa/beta-history-detail-implementation.png` at the protected iPhone screen size of 393 × 852.
- Browser method: Codex in-app browser for live landing/auth inspection and console review; the synthetic two-account stateful flow used the repository Playwright runner because Browser safety rules do not permit silently creating test accounts through the user-facing browser connector.
- Core path verified: account A + account B → partner invite → isolated shared space → remote room → two perspectives → real AI mediation → account-specific private feedback → two confirmations → shared history detail.
- Copy diff: no unapproved hero copy changes. New visible identity, invitation, confirmation, and history copy is limited to the functional surfaces required by the request and is bilingual.

Fidelity ledger:

1. Palette: warm ivory, vermilion, ultramarine, charcoal, and muted gray preserved across every new surface.
2. Typography: vertical Song-style headings and compact bilingual UI chrome match the approved editorial hierarchy.
3. Motif: opposing color columns, paired circles, pause mark, and split-color CTA carry the original “two sides choosing each other” idea into the product flow.
4. Container model: login uses open form fields, invitation uses one focused panel, dashboard uses rails/lists, and history uses a timeline list; no generic card grid was introduced.
5. Responsive behavior: the three new primary surfaces were captured and inspected at the native 393 × 852 app viewport with no clipping or horizontal overflow.
6. Interaction state: disabled actions, waiting-for-partner, one-of-two confirmations, completed archive, empty history, populated history, and private/shared analysis states were exercised.
7. Icons: existing Phosphor line/filled treatment is retained; no emoji or mismatched icon family was added.

Material fixes during QA:

- Added the missing blue lower rail to the login screen so the approved two-sided composition remains present beyond the landing page.
- Hid the prototype-only custom cursor while capturing evidence; runtime behavior itself was not changed.
- Fixed history navigation so returning from a freshly archived review loads the populated shared list instead of an empty client cache.

Remaining intentional differences:

- Product data is real and variable, so row copy and line breaks do not reproduce ImageGen’s illustrative sample text verbatim.
- The protected live status bar and home indicator remain visible.
- The nearest installed Song-style system font is used instead of embedding a commercial reference typeface.

No actionable P0, P1, or P2 visual mismatch remains. The implementation was faithfully verified against the approved visual direction and the extension concept.

final result: passed

## No-download QR demo extension — passed

- Accepted source: `public/assets/brand/approved-visual-reference.png`.
- Generated extension concept: `qa/demo-flow-concept.png`.
- Latest native implementation evidence: `qa/demo-invite-final.png` at 393 × 852 CSS px.
- Screenshot method: Codex in-app Browser for DOM/state inspection; repository Playwright captured the native protected device screen because the acceptance path requires two isolated browser contexts.
- Core flow: guest host → QR invite → isolated partner device → two consent actions → one message per person → AI analysis → two registrations → two save confirmations → formal shared history.

Fidelity comparison:

1. Palette: the accepted ivory, vermilion, ultramarine, ink, and muted gray tokens are unchanged.
2. Composition: opposing granular rails frame one calm editorial center; the QR is the single dominant object on the invite state.
3. Typography: Song-style Chinese display text, wide-tracked Toward Us wordmark, and compact sans UI copy preserve the hierarchy.
4. Motifs: the three-part pause mark, paired color roles, clipped rails, and diagonal split action treatment continue the approved visual language.
5. Container model: controls sit on the open paper field with fine rules; no glass panels, gradients, rounded card grid, or generic SaaS dashboard was introduced.
6. Native viewport: entry, invite, consent, conversation, analysis, and conversion states were exercised at the protected iPhone 393 × 852 screen size; the latest QR state has no clipping or simulated-keyboard obstruction.
7. Interaction and privacy: disabled creation, expiring invitation, two independent consent actions, private/shared analysis, one-of-two save, and completed conversion states were all exercised.

Above-the-fold copy diff:

- The approved home statement and formal landing copy were not changed.
- The demo entry adds only “快速体验 / Quick demo,” mode selection, participant name, and the truthful one-hour retention notice.
- The generated concept suggested local-only processing. The implementation intentionally says raw audio is not saved while temporary transcripts and analysis are server-held for up to one hour, because that matches the real two-device architecture.

Material fix during QA:

- The second device originally received completed AI state through SSE but had no visible navigation into the analysis. A shared “查看 AI 分析 / View AI analysis” action was added and the two-device acceptance test was rerun successfully.

Intentional differences:

- The QR code and room code are live, scannable values rather than the concept's illustrative placeholders.
- The protected iPhone status bar, rounded screen corners, and home indicator remain.
- The implementation uses the nearest installed Song-style system font instead of embedding a commercial reference typeface.

No actionable P0, P1, or P2 visual mismatch remains. The QR demo was faithfully verified against both the approved visual source and the generated extension concept.

final result: passed
