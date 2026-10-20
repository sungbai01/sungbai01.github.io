# StPageFlip 2.0.7 — local performance fixes

Source copied from the installed `page-flip@2.0.7` package (https://github.com/Nodlik/StPageFlip).
The upstream MIT license is included in LICENSE.

Local changes:
- Cancel the animation-frame loop on destroy; ignore deferred initialization after disposal.
- Skip DOM painting when idle and no render state changed.
- Hide pages at creation and update visibility for only the previous/current spread, rather than scanning the full book each frame.

Keep these changes when updating the upstream source. The reader imports this local source so every build uses the same fixes without modifying node_modules.
