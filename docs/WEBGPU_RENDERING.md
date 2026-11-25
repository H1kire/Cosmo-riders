# WebGPU rendering migration

WebGPU is the target rendering API, with TypeScript owning GPUAdapter/GPUDevice/GPUQueue and resource lifetimes and WGSL owning all new shader programs.

**Current status:** the production Solar3DView still uses WebGL2. Its scene graph, multi-light planet shading, atmosphere/cloud passes, rings, HDR target, bloom and tone mapping are tightly coupled to WebGL2 state and shader interfaces. The WebGL2 renderer is therefore retained as the active renderer while a complete WebGPU scene backend is not yet implemented.

A valid migration must port the complete shared scene—not create an isolated planet scene—and preserve the global/local camera projection, render origin, body selection, orbit paths, labels, atmosphere, clouds, rings, shadows, HDR and post-processing. WebGPU runtime availability must be detected and device loss handled before it can become the primary backend. The existing WebGL2 renderer must remain as fallback until parity is demonstrated.
