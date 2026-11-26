# WebGPU renderer — implementation status

The initial native WebGPU sphere backend is in `src/rendering/webgpu/webgpu-backend.ts`.

Implemented in this increment:
- GPU adapter and device requests with explicit unavailable/error states.
- A real `GPUCanvasContext` configured with the browser-preferred canvas format.
- WGSL vertex/fragment shader compilation and asynchronous render-pipeline creation.
- Depth texture and depth-tested indexed sphere draws.
- Reusable CPU sphere geometry and persistent per-body uniform buffers/bind groups.
- Canvas resize handling and bounded 1920×1080 backing resolution.
- Device-loss reporting and one recovery attempt API.
- Explicit resource destruction.

Not yet integrated into `Solar3DView`: the scene frame is not routed to this backend, so the application must not report WebGPU as active or ready. The existing WebGL2 renderer remains the only active application renderer. Orbits, atmosphere, clouds, rings, geodesic pages, HDR/post-processing, UI backend selection, automatic fallback, and browser runtime smoke tests remain pending.

This is an implementation increment, not completion of the WebGPU migration.
