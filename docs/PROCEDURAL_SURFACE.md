# Procedural surface migration

Geodesic surface page generation and triangular mesh construction are now implemented in the Rust core and invoked by the existing worker. The current page profile contract is passed as compact JSON metadata; generated image/geometry payloads are returned as typed arrays.

The five page channels are retained:

| Channel | CPU representation | Meaning |
|---|---|---|
| Albedo | Uint8Array, RGBA | Surface colour |
| Normal | Uint8Array, RGB | Encoded surface normal |
| Height | Float32Array | Height in metres |
| Roughness | Uint8Array | Roughness |
| Material ID | Uint8Array | Material lookup ID |

Height is converted to metres using the body's mean radius. Earth's existing -11 km/+9 km physical clamp is preserved. The same seed, tile ID, profile, resolution and gutter are deterministic inputs.

The Rust implementation is being validated against the TypeScript page generator through deterministic channel-size, repeatability and height-range tests. Exact pixel parity across Rust and JavaScript floating-point implementations must be established before the old implementation is removed. The TypeScript generator remains in the source tree as the reference/fallback implementation, but the active geodesic worker now calls Rust.
