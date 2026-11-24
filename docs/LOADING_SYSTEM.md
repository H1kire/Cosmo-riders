# Loading System

## Status

A lightweight loading overlay and dynamic application import are implemented for /lab/. The overlay is part of initial HTML and CSS; lab/main.ts waits for one animation frame before importing lab/lab.ts.

This is the first bootstrap boundary, not yet a fully asynchronous resource pipeline. lab.ts still performs substantial synchronous initialization, including Solar3DView, WebGL programs, HDR targets, sphere meshes and the physical world. The overlay can be visible before this work begins, but its animation and progress updates cannot run while a long synchronous task occupies the main thread.

## Stages currently reported

| Stage | Weight | Completion condition |
|---|---:|---|
| Application bootstrap | 5% | Initial HTML/CSS and loading controller have reached their first frame |
| Core data & rendering | 85% | Dynamic import of lab.ts has completed |
| Initial scene | 10% | A subsequent animation frame has run after module initialization |

The progress bar advances only when a stage completes. During dynamic import it is indeterminate because the module graph and synchronous initialization do not expose reliable byte or task progress. The percentage is not a simulated byte counter.

## Errors

Import or initialization failures are logged to the console and shown in the loading overlay. A retry control reloads the page. This currently covers bootstrap import failures and errors thrown during module evaluation.

## Remaining work

- Refactor lab.ts into explicit asynchronous initialization steps.
- Separate physical data construction from GPU resource creation.
- Yield between renderer setup operations.
- Use KHR_parallel_shader_compile where available and poll completion across frames.
- Split mandatory first-frame resources from optional surface detail.
- Move tile generation to the geodesic Worker pool and stream detail after entry.
- Add cancellation, context-loss recovery and resource cleanup across the full boot lifecycle.
- Instrument real phase durations and first-frame timestamps in-browser.

The current overlay improves initial feedback and establishes a dynamic-import boundary. It does not by itself prove that long main-thread stalls have been eliminated.