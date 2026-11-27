# WebGPU long-running stability

This note records the lifecycle protections added for the active WebGPU renderer.

- Initialization is generation-scoped. A late adapter/device/pipeline completion cannot promote a disposed or superseded backend to ready.
- A device-loss callback is bound to the device and initialization generation that created it, so stale loss notifications cannot invalidate a recovered device.
- Recovery is single-flight and bounded to three attempts per backend lifetime. Each attempt tears down the previous renderer resources, timestamp-query resources and lost device before creating a new device.
- Timestamp readbacks carry a generation token. Late mapAsync completions from an old device cannot update current GPU timing diagnostics.
- Partial initialization failures release resources created by that initialization.
- A ready surface worker that crashes or returns an unreadable message is terminated and replaced, up to three restarts per pool lifetime. Startup failures are not retried in a tight loop.
- Worker restart counts are exposed with the existing CPU/GPU surface-cache diagnostics.
- Disposing the worker pool rejects all outstanding subscribers and terminates its workers; surface runtimes clear in-flight bookkeeping and release pinned GPU pages.

Recovery is deliberately bounded: repeated device loss beyond the retry limit leaves the backend in a failed state with an explicit error instead of creating an unbounded restart loop. Browser/driver-level VRAM reclamation and GPU utilization remain outside the WebGPU API's portable guarantees.
