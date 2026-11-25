# Physics core migration

The Rust core contains f64 vector math, Stumpff functions, universal-variable Kepler propagation, state-vector to classical-element conversion and elliptic-elements to state-vector conversion. SI units and the J2000-relative time convention are retained.

The wasm-bindgen bridge exports universal-variable propagation using Float64Array input/output. The existing TypeScript physics modules remain the active simulation authority for now: PhysicsWorld, body hierarchy, ephemeris updates, vessel propagation, patched-conic primary switching, SOI transitions, propulsion and maneuver execution still need a complete snapshot-oriented Rust API and reference-parity tests before switching the application over.

This boundary is deliberate: the project must not run two independent physics worlds in parallel or change physical results as a side effect of the language migration.
