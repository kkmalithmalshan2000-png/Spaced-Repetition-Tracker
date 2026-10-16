# Nexus scrolling performance audit

## Scope
This change targets browser main-thread/compositing work that can make scrolling feel uneven on mobile and desktop. It does not change the FSRS scheduling logic, stored study data, authentication, Supabase schema, or production deployment configuration.

## Findings from source inspection
- Large app surfaces (panels, stat cards, topic cards, queue items) were assigned entrance animations and broad `transition: all` styling. Animating many large surfaces together can create avoidable style, paint, and compositing work.
- Card hover effects applied transforms and shadows, which can trigger additional work while the pointer moves across a dense desktop layout.
- The tab bar and other surfaces used backdrop blur. Blur can be expensive to composite on lower-powered mobile GPUs.
- The wishlist polled every five seconds and could attempt a request while offline. Repeated failed requests consume network, timer, and JavaScript work without improving the offline experience.

## Changes
- Disable entrance animations on large content surfaces and the app wrapper.
- Remove transform-on-hover movement from large cards; retain a lightweight border/shadow transition.
- Remove backdrop blur from the tab bar and modal backdrop.
- Disable smooth programmatic scrolling and the animated max-height expansion on the collapsible content body.
- Increase wishlist fallback polling from 5 seconds to 30 seconds, skip refreshes while offline or the document is hidden, and refresh on the browser's `online` event.
- Add Node's built-in test checks to prevent these performance guardrails from regressing.

## Verification status and limits
- Source-level regression checks are included in `tests/performance-audit.test.mjs`.
- This audit confirms code paths and style overrides; it does **not** claim a measured 60/90/120 FPS result. A reliable FPS/long-task comparison requires running the preview in real mobile and desktop browsers with representative study data, both online and offline.
- No CSS or application change can guarantee zero dropped frames on every device. The goal is to remove avoidable work and verify real-world behavior before merge.
- Do not merge until the PR preview has been tested on a phone and desktop, including offline reload and wishlist recovery after reconnecting.
