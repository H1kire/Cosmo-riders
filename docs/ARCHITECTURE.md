# Cosmo-riders architecture

## Responsibility boundaries

- **TypeScript** owns the browser application, DOM, menus, camera input, scene coordination, diagnostics and GPU command submission.
- **Rust** owns numerical and data-parallel CPU work: orbital mathematics, geodesic topology/mesh generation and deterministic planetary surface pages.
- **WebAssembly** exposes Rust functions to browser workers. Large page channels cross the boundary as typed arrays, not JSON.
- **WebGPU/WGSL** is the target graphics backend. It must own GPU resources and render/compute pipelines; Rust does not issue WebGPU commands.

## Current source integration

The existing geodesic Worker is now the WASM execution boundary. It initializes the generated wasm-bindgen module once, then handles mesh and surface-page tasks. The existing TypeScript worker pool still owns prioritization, deduplication, cancellation, bounded concurrency and transferable buffers. This keeps the current page cache and WebGL2 renderer contract intact while moving the actual geometry and surface calculations off the UI thread into Rust.

The active scene and the full physics world still use their existing TypeScript/WebGL2 implementations. They are intentionally retained until their replacements pass parity and integration checks. This is an incremental migration, not a claim that the entire renderer or simulation has already moved.

## Data conventions

- Physics uses SI units and f64 internally.
- Render positions remain camera-relative before conversion to GPU f32.
- Surface tile height output is f32 in **metres**, after multiplying the dimensionless terrain fraction by the body's mean radius.
- Surface pages preserve Albedo RGBA8, Normal RGB8, Height f32 in CPU memory, Roughness R8 and Material ID R8 channels.
- A worker transfers owned ArrayBuffers to the renderer; no borrowed view into WASM linear memory is retained after a call.
