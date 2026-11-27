# WebGPU multilayer cloud rendering

The active WebGPU effect pass now renders each configured cloud deck as its own spherical shell and evaluates a bounded volumetric density integral through the shell thickness.

- Cloud density combines warped macro, meso and fine FBM fields with erosion and coverage thresholds.
- Each layer has independent altitude, physical thickness, opacity, coverage, scale, wind, erosion and detail controls.
- The view-ray integral is bounded to 4–12 samples by the active graphics cloud-detail setting.
- Wind advects each layer independently in simulation time; planetary rotation remains inherited from the body's simulation-driven model transform.
- Direct sunlight includes local cloud self-shadowing, existing planetary occluder visibility and eclipse visibility.
- A Henyey–Greenstein forward-scattering term provides the bright forward-scattering edge response.
- Gas-giant decks can modulate density by latitude to produce zonal cloud bands.
- The result remains linear HDR and is composited by the existing WebGPU effect pipeline.

This is a real-time, single-view-ray volumetric approximation over layered spherical cloud decks. It is not a full fluid simulation, weather solver, or temporally accumulated 3D cloud volume. Cloud shadows onto the underlying solid terrain are not yet a separate shadow-map pass. Visual tuning is deferred to the final 13-point browser review.
