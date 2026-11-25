use crate::physics::Vec3;

const G: f64 = 6.67430e-11;

#[derive(Clone, Debug)]
pub struct NBody {
    pub id: String,
    pub mass_kg: f64,
    pub collision_radius_m: f64,
    pub equatorial_radius_m: f64,
    pub j2: f64,
    pub pole_axis: Vec3,
    pub position: Vec3,
    pub velocity: Vec3,
}

#[derive(Clone, Debug)]
pub struct NBodySystem {
    bodies: Vec<NBody>,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct AdaptiveAdvanceStats {
    pub accepted_steps: usize,
    pub rejected_steps: usize,
    pub minimum_step_seconds: f64,
    pub maximum_normalized_error: f64,
}

fn axis_projection_squared(relative: Vec3, axis: Vec3, distance: f64) -> f64 {
    let projection = relative.x * axis.x + relative.y * axis.y + relative.z * axis.z;
    (projection / distance).powi(2)
}

fn j2_acceleration(body: &NBody, relative: Vec3) -> Result<Vec3, String> {
    if body.j2 == 0.0 { return Ok(Vec3::new(0.0, 0.0, 0.0)); }
    let r2 = relative.norm2();
    if !r2.is_finite() || r2 <= body.collision_radius_m.powi(2) {
        return Err(format!("J2 field query intersects {}.", body.id));
    }
    let projection = relative.x * body.pole_axis.x + relative.y * body.pole_axis.y + relative.z * body.pole_axis.z;
    let z2_over_r2 = projection * projection / r2;
    let perpendicular = relative.sub(body.pole_axis.scale(projection));
    let shape = perpendicular.scale(5.0 * z2_over_r2 - 1.0)
        .add(body.pole_axis.scale(projection * (5.0 * z2_over_r2 - 3.0)));
    let factor = 1.5 * G * body.mass_kg * body.j2 * body.equatorial_radius_m.powi(2)
        / (r2 * r2 * r2.sqrt());
    let acceleration = shape.scale(factor);
    if acceleration.finite() { Ok(acceleration) } else { Err("J2 acceleration became non-finite.".into()) }
}

fn normalized_step_error(coarse: &NBodySystem, fine: &NBodySystem, relative_tolerance: f64) -> f64 {
    let length_scale = coarse.bodies.iter().chain(fine.bodies.iter())
        .map(|body| body.position.norm()).fold(1.0_f64, f64::max);
    let speed_scale = coarse.bodies.iter().chain(fine.bodies.iter())
        .map(|body| body.velocity.norm()).fold(1.0_f64, f64::max);
    let position_scale = 1.0e-3 + relative_tolerance * length_scale;
    let velocity_scale = 1.0e-9 + relative_tolerance * speed_scale;
    let mut maximum: f64 = 0.0;
    for (a, b) in coarse.bodies.iter().zip(fine.bodies.iter()) {
        let position_error = b.position.sub(a.position).norm() / position_scale;
        let velocity_error = b.velocity.sub(a.velocity).norm() / velocity_scale;
        maximum = maximum.max(position_error).max(velocity_error);
    }
    if maximum.is_finite() { maximum } else { f64::INFINITY }
}

fn interpolated_particle_acceleration(
    start: &NBodySystem,
    end: &NBodySystem,
    position: Vec3,
    fraction: f64,
) -> Result<Vec3, String> {
    let mut result = Vec3::new(0.0, 0.0, 0.0);
    for (a, b) in start.bodies.iter().zip(end.bodies.iter()) {
        let body_position = a.position.add(b.position.sub(a.position).scale(fraction));
        let delta = body_position.sub(position);
        let r2 = delta.norm2();
        if !r2.is_finite() || r2 <= a.collision_radius_m.powi(2) {
            return Err(format!("Test particle intersects {}.", a.id));
        }
        result = result.add(delta.scale(G * a.mass_kg / (r2 * r2.sqrt())));
        result = result.add(j2_acceleration(a, position.sub(body_position))?);
    }
    if result.finite() { Ok(result) } else { Err("Test-particle acceleration became non-finite.".into()) }
}

fn rk4_test_particle_step(
    start: &NBodySystem,
    end: &NBodySystem,
    position: Vec3,
    velocity: Vec3,
    elapsed: f64,
    step: f64,
    total_duration: f64,
) -> Result<(Vec3, Vec3), String> {
    let acceleration = |p: Vec3, t: f64| interpolated_particle_acceleration(start, end, p, t / total_duration);
    let k1p = velocity;
    let k1v = acceleration(position, elapsed)?;
    let k2p = velocity.add(k1v.scale(step * 0.5));
    let k2v = acceleration(position.add(k1p.scale(step * 0.5)), elapsed + step * 0.5)?;
    let k3p = velocity.add(k2v.scale(step * 0.5));
    let k3v = acceleration(position.add(k2p.scale(step * 0.5)), elapsed + step * 0.5)?;
    let k4p = velocity.add(k3v.scale(step));
    let k4v = acceleration(position.add(k3p.scale(step)), elapsed + step)?;
    let weighted = |a: Vec3, b: Vec3, c: Vec3, d: Vec3| a.add(b.scale(2.0)).add(c.scale(2.0)).add(d).scale(step / 6.0);
    let next_position = position.add(weighted(k1p, k2p, k3p, k4p));
    let next_velocity = velocity.add(weighted(k1v, k2v, k3v, k4v));
    if next_position.finite() && next_velocity.finite() { Ok((next_position, next_velocity)) }
    else { Err("Test-particle RK4 integration became non-finite.".into()) }
}

impl NBodySystem {
    pub fn new(mut bodies: Vec<NBody>) -> Result<Self, String> {
        if bodies.is_empty() {
            return Err("N-body system must contain at least one body.".into());
        }
        let mut ids = std::collections::HashSet::with_capacity(bodies.len());
        for body in &mut bodies {
            if body.id.trim().is_empty() || !ids.insert(body.id.clone()) {
                return Err("N-body identifiers must be non-empty and unique.".into());
            }
            if !body.mass_kg.is_finite() || body.mass_kg <= 0.0 {
                return Err(format!("Invalid mass for {}.", body.id));
            }
            if !body.collision_radius_m.is_finite() || body.collision_radius_m < 0.0 {
                return Err(format!("Invalid collision radius for {}.", body.id));
            }
            if !body.equatorial_radius_m.is_finite() || body.equatorial_radius_m <= 0.0 || !body.j2.is_finite() {
                return Err(format!("Invalid J2 gravity parameters for {}.", body.id));
            }
            body.pole_axis = body.pole_axis.normalized()?;
            if !body.position.finite() || !body.velocity.finite() {
                return Err(format!("Non-finite initial state for {}.", body.id));
            }
        }
        Ok(Self { bodies })
    }

    pub fn bodies(&self) -> &[NBody] { &self.bodies }

    pub fn total_momentum(&self) -> Vec3 {
        self.bodies.iter().fold(Vec3::new(0.0, 0.0, 0.0), |sum, b| {
            sum.add(b.velocity.scale(b.mass_kg))
        })
    }

    pub fn total_energy(&self) -> Result<f64, String> {
        let mut energy = 0.0;
        for body in &self.bodies {
            energy += 0.5 * body.mass_kg * body.velocity.norm2();
        }
        for i in 0..self.bodies.len() {
            for j in (i + 1)..self.bodies.len() {
                let a = &self.bodies[i];
                let b = &self.bodies[j];
                let distance = b.position.sub(a.position).norm();
                if !distance.is_finite() || distance <= a.collision_radius_m + b.collision_radius_m {
                    return Err(format!("Collision or singular separation between {} and {}.", a.id, b.id));
                }
                energy -= G * a.mass_kg * b.mass_kg / distance;
                let relative = b.position.sub(a.position);
                let p2_a = 0.5 * (3.0 * axis_projection_squared(relative, a.pole_axis, distance) - 1.0);
                let p2_b = 0.5 * (3.0 * axis_projection_squared(relative, b.pole_axis, distance) - 1.0);
                energy += G * a.mass_kg * b.mass_kg / distance
                    * (a.j2 * (a.equatorial_radius_m / distance).powi(2) * p2_a
                        + b.j2 * (b.equatorial_radius_m / distance).powi(2) * p2_b);
            }
        }
        if energy.is_finite() { Ok(energy) } else { Err("N-body energy became non-finite.".into()) }
    }

    fn accelerations(&self) -> Result<Vec<Vec3>, String> {
        let mut acceleration = vec![Vec3::new(0.0, 0.0, 0.0); self.bodies.len()];
        for i in 0..self.bodies.len() {
            for j in (i + 1)..self.bodies.len() {
                let a = &self.bodies[i];
                let b = &self.bodies[j];
                let delta = b.position.sub(a.position);
                let r2 = delta.norm2();
                let minimum = a.collision_radius_m + b.collision_radius_m;
                if !r2.is_finite() || r2 <= minimum * minimum {
                    return Err(format!("Collision or singular separation between {} and {}.", a.id, b.id));
                }
                let inverse_r3 = 1.0 / (r2 * r2.sqrt());
                acceleration[i] = acceleration[i].add(delta.scale(G * b.mass_kg * inverse_r3));
                acceleration[j] = acceleration[j].sub(delta.scale(G * a.mass_kg * inverse_r3));
                let j2_on_a = j2_acceleration(b, a.position.sub(b.position))?;
                let j2_on_b = j2_acceleration(a, b.position.sub(a.position))?;
                acceleration[i] = acceleration[i].add(j2_on_a).sub(j2_on_b.scale(b.mass_kg / a.mass_kg));
                acceleration[j] = acceleration[j].add(j2_on_b).sub(j2_on_a.scale(a.mass_kg / b.mass_kg));
            }
        }
        if acceleration.iter().all(|a| a.finite()) { Ok(acceleration) }
        else { Err("N-body acceleration became non-finite.".into()) }
    }

    pub fn acceleration_at(&self, position: Vec3) -> Result<Vec3, String> {
        if !position.finite() { return Err("Test-particle position must be finite.".into()); }
        let mut result = Vec3::new(0.0, 0.0, 0.0);
        for body in &self.bodies {
            let delta = body.position.sub(position);
            let r2 = delta.norm2();
            if !r2.is_finite() || r2 <= body.collision_radius_m.powi(2) {
                return Err(format!("Test particle intersects {}.", body.id));
            }
            result = result.add(delta.scale(G * body.mass_kg / (r2 * r2.sqrt())));
            result = result.add(j2_acceleration(body, position.sub(body.position))?);
        }
        if result.finite() { Ok(result) } else { Err("Test-particle acceleration became non-finite.".into()) }
    }

    /// Kick-drift-kick velocity Verlet (leapfrog), symmetric and second-order.
    pub fn step(&mut self, dt_seconds: f64) -> Result<(), String> {
        if !dt_seconds.is_finite() || dt_seconds == 0.0 {
            return Err("N-body step must be finite and non-zero.".into());
        }
        let initial_acceleration = self.accelerations()?;
        let mut candidate = self.clone();
        for (body, acceleration) in candidate.bodies.iter_mut().zip(initial_acceleration.iter()) {
            body.position = body.position
                .add(body.velocity.scale(dt_seconds))
                .add(acceleration.scale(0.5 * dt_seconds * dt_seconds));
        }
        let final_acceleration = candidate.accelerations()?;
        for (body, (a0, a1)) in candidate.bodies.iter_mut().zip(initial_acceleration.iter().zip(final_acceleration.iter())) {
            body.velocity = body.velocity.add(a0.add(*a1).scale(0.5 * dt_seconds));
        }
        *self = candidate;
        Ok(())
    }

    pub fn advanced(&self, duration_seconds: f64, max_step_seconds: f64) -> Result<Self, String> {
        if !duration_seconds.is_finite() || !max_step_seconds.is_finite() || max_step_seconds <= 0.0 {
            return Err("N-body duration must be finite and maxStepSeconds must be positive.".into());
        }
        let count = (duration_seconds.abs() / max_step_seconds).ceil().max(1.0) as usize;
        if count > 1_000_000 { return Err("N-body advance exceeds the one-million-substep safety limit.".into()); }
        let dt = duration_seconds / count as f64;
        let mut next = self.clone();
        if duration_seconds != 0.0 {
            for _ in 0..count { next.step(dt)?; }
        }
        Ok(next)
    }

    /// Step-doubling adaptive wrapper around the existing kick-drift-kick integrator.
    /// The accepted state is always the two-half-step solution; the full-step solution
    /// supplies a local error estimate. Variable step sizes are not exactly symplectic.
    pub fn advanced_adaptive(
        &self,
        duration_seconds: f64,
        max_step_seconds: f64,
        relative_tolerance: f64,
        min_step_seconds: f64,
        max_substeps: usize,
    ) -> Result<(Self, AdaptiveAdvanceStats), String> {
        if !duration_seconds.is_finite()
            || !max_step_seconds.is_finite() || max_step_seconds <= 0.0
            || !relative_tolerance.is_finite() || relative_tolerance <= 0.0
            || !min_step_seconds.is_finite() || min_step_seconds <= 0.0
            || max_substeps == 0
        {
            return Err("Adaptive N-body parameters must be finite and positive.".into());
        }
        let mut stats = AdaptiveAdvanceStats::default();
        if duration_seconds == 0.0 {
            stats.minimum_step_seconds = 0.0;
            return Ok((self.clone(), stats));
        }

        let direction = duration_seconds.signum();
        let mut remaining = duration_seconds;
        let mut h = direction * max_step_seconds.min(duration_seconds.abs());
        let mut accepted = self.clone();
        let max_attempts = max_substeps.saturating_mul(24).max(max_substeps);
        let time_epsilon = duration_seconds.abs().max(1.0) * 1.0e-14;
        let mut attempts = 0_usize;

        while remaining.abs() > time_epsilon {
            attempts += 1;
            if attempts > max_attempts {
                return Err("Adaptive N-body integration exceeded its attempt budget.".into());
            }
            if h.abs() > remaining.abs() { h = remaining; }

            let mut coarse = accepted.clone();
            let coarse_result = coarse.step(h);
            let mut fine = accepted.clone();
            let fine_result = fine.step(h * 0.5).and_then(|_| fine.step(h * 0.5));
            if let Err(error) = coarse_result.and(fine_result) {
                stats.rejected_steps += 1;
                if h.abs() <= min_step_seconds * (1.0 + 1.0e-12) {
                    return Err(error);
                }
                h = direction * (h.abs() * 0.5).max(min_step_seconds);
                continue;
            }

            let error = normalized_step_error(&coarse, &fine, relative_tolerance);
            if error <= 1.0 {
                accepted = fine;
                remaining = (remaining - h).abs().max(0.0) * direction;
                stats.accepted_steps += 1;
                stats.minimum_step_seconds = if stats.minimum_step_seconds == 0.0 {
                    h.abs()
                } else {
                    stats.minimum_step_seconds.min(h.abs())
                };
                stats.maximum_normalized_error = stats.maximum_normalized_error.max(error);
                if stats.accepted_steps > max_substeps {
                    return Err("Adaptive N-body integration exceeded its substep budget.".into());
                }
                let factor = if error <= 1.0e-16 {
                    2.0
                } else {
                    (0.9 * (1.0 / error).powf(1.0 / 3.0)).clamp(0.5, 2.0)
                };
                h = direction * (h.abs() * factor).min(max_step_seconds);
            } else {
                stats.rejected_steps += 1;
                if h.abs() <= min_step_seconds * (1.0 + 1.0e-12) {
                    return Err("Adaptive N-body local error remains above tolerance at the minimum step.".into());
                }
                let factor = (0.9 * (1.0 / error).powf(1.0 / 3.0)).clamp(0.1, 0.5);
                h = direction * (h.abs() * factor).max(min_step_seconds);
            }
        }

        if stats.accepted_steps == 0 { stats.minimum_step_seconds = 0.0; }
        Ok((accepted, stats))
    }

    /// Adaptive RK4 integration for a massless spacecraft in the linearly interpolated
    /// massive-body field spanning the committed N-body step.
    pub fn integrate_test_particle_adaptive(
        start: &Self,
        end: &Self,
        position: Vec3,
        velocity: Vec3,
        duration_seconds: f64,
        max_step_seconds: f64,
        relative_tolerance: f64,
        min_step_seconds: f64,
        max_substeps: usize,
    ) -> Result<(Vec3, Vec3, AdaptiveAdvanceStats), String> {
        if !duration_seconds.is_finite() || !position.finite() || !velocity.finite()
            || !max_step_seconds.is_finite() || max_step_seconds <= 0.0
            || !relative_tolerance.is_finite() || relative_tolerance <= 0.0
            || !min_step_seconds.is_finite() || min_step_seconds <= 0.0 || max_substeps == 0
            || start.bodies.len() != end.bodies.len()
        {
            return Err("Invalid adaptive test-particle integration parameters.".into());
        }
        if duration_seconds == 0.0 {
            let mut stats = AdaptiveAdvanceStats::default();
            stats.minimum_step_seconds = 0.0;
            return Ok((position, velocity, stats));
        }

        let direction = duration_seconds.signum();
        let mut elapsed = 0.0;
        let mut remaining = duration_seconds;
        let mut h = direction * max_step_seconds.min(duration_seconds.abs());
        let mut p = position;
        let mut v = velocity;
        let mut stats = AdaptiveAdvanceStats::default();
        let mut attempts = 0_usize;
        let max_attempts = max_substeps.saturating_mul(24).max(max_substeps);
        let epsilon = duration_seconds.abs().max(1.0) * 1.0e-14;

        while remaining.abs() > epsilon {
            attempts += 1;
            if attempts > max_attempts {
                return Err("Adaptive test-particle integration exceeded its attempt budget.".into());
            }
            if h.abs() > remaining.abs() { h = remaining; }
            let coarse = rk4_test_particle_step(start, end, p, v, elapsed, h, duration_seconds);
            let half = rk4_test_particle_step(start, end, p, v, elapsed, h * 0.5, duration_seconds)
                .and_then(|(p_half, v_half)| rk4_test_particle_step(start, end, p_half, v_half, elapsed + h * 0.5, h * 0.5, duration_seconds));
            let ((coarse_p, coarse_v), (fine_p, fine_v)) = match (coarse, half) {
                (Ok(coarse), Ok(fine)) => (coarse, fine),
                (Err(error), _) | (_, Err(error)) => {
                    stats.rejected_steps += 1;
                    if h.abs() <= min_step_seconds * (1.0 + 1.0e-12) { return Err(error); }
                    h = direction * (h.abs() * 0.5).max(min_step_seconds);
                    continue;
                }
            };
            let body_length = start.bodies.iter().chain(end.bodies.iter())
                .map(|body| body.position.norm()).fold(1.0_f64, f64::max);
            let body_speed = start.bodies.iter().chain(end.bodies.iter())
                .map(|body| body.velocity.norm()).fold(1.0_f64, f64::max);
            let p_scale = 1.0e-3 + relative_tolerance * body_length.max(p.norm()).max(fine_p.norm());
            let v_scale = 1.0e-9 + relative_tolerance * body_speed.max(v.norm()).max(fine_v.norm());
            let error = (fine_p.sub(coarse_p).norm() / p_scale)
                .max(fine_v.sub(coarse_v).norm() / v_scale);
            if !error.is_finite() {
                return Err("Adaptive test-particle error estimate became non-finite.".into());
            }
            if error <= 1.0 {
                p = fine_p;
                v = fine_v;
                elapsed += h;
                remaining = (remaining - h).abs().max(0.0) * direction;
                stats.accepted_steps += 1;
                stats.minimum_step_seconds = if stats.minimum_step_seconds == 0.0 { h.abs() } else { stats.minimum_step_seconds.min(h.abs()) };
                stats.maximum_normalized_error = stats.maximum_normalized_error.max(error);
                if stats.accepted_steps > max_substeps {
                    return Err("Adaptive test-particle integration exceeded its substep budget.".into());
                }
                let factor = if error <= 1.0e-16 { 2.0 } else { (0.9 * (1.0 / error).powf(1.0 / 3.0)).clamp(0.5, 2.0) };
                h = direction * (h.abs() * factor).min(max_step_seconds);
            } else {
                stats.rejected_steps += 1;
                if h.abs() <= min_step_seconds * (1.0 + 1.0e-12) {
                    return Err("Adaptive test-particle error remains above tolerance at the minimum step.".into());
                }
                let factor = (0.9 * (1.0 / error).powf(1.0 / 3.0)).clamp(0.1, 0.5);
                h = direction * (h.abs() * factor).max(min_step_seconds);
            }
        }
        if stats.accepted_steps == 0 { stats.minimum_step_seconds = 0.0; }
        Ok((p, v, stats))
    }

    /// Integrate a massless spacecraft in the same time-dependent N-body field.
    pub fn integrate_test_particle(
        start: &Self, end: &Self, position: Vec3, velocity: Vec3, dt_seconds: f64
    ) -> Result<(Vec3, Vec3), String> {
        let a0 = start.acceleration_at(position)?;
        let half_velocity = velocity.add(a0.scale(0.5 * dt_seconds));
        let next_position = position.add(half_velocity.scale(dt_seconds));
        let a1 = end.acceleration_at(next_position)?;
        let next_velocity = half_velocity.add(a1.scale(0.5 * dt_seconds));
        if next_position.finite() && next_velocity.finite() { Ok((next_position, next_velocity)) }
        else { Err("Test-particle integration became non-finite.".into()) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn circular_pair() -> NBodySystem {
        let sun_mass = 1.98847e30;
        let planet_mass = 5.9722e24;
        let radius = 1.495978707e11;
        let speed = (G * (sun_mass + planet_mass) / radius).sqrt();
        let total = sun_mass + planet_mass;
        let sun_r = -radius * planet_mass / total;
        let planet_r = radius * sun_mass / total;
        let sun_v = -speed * planet_mass / total;
        let planet_v = speed * sun_mass / total;
        NBodySystem::new(vec![
            NBody { id: "sun".into(), mass_kg: sun_mass, collision_radius_m: 6.957e8, equatorial_radius_m: 6.957e8, j2: 0.0, pole_axis: Vec3::new(0.0,0.0,1.0),
                position: Vec3::new(sun_r, 0.0, 0.0), velocity: Vec3::new(0.0, sun_v, 0.0) },
            NBody { id: "earth".into(), mass_kg: planet_mass, collision_radius_m: 6.371e6, equatorial_radius_m: 6.371e6, j2: 0.0, pole_axis: Vec3::new(0.0,0.0,1.0),
                position: Vec3::new(planet_r, 0.0, 0.0), velocity: Vec3::new(0.0, planet_v, 0.0) },
        ]).unwrap()
    }

    #[test]
    fn j2_changes_equatorial_and_polar_gravity_with_correct_sign() {
        let base = NBody { id: "earth".into(), mass_kg: 5.9722e24, collision_radius_m: 6.371e6,
            equatorial_radius_m: 6.3781366e6, j2: 0.0, pole_axis: Vec3::new(0.0,0.0,1.0),
            position: Vec3::new(0.0,0.0,0.0), velocity: Vec3::new(0.0,0.0,0.0) };
        let mut oblate = base.clone(); oblate.j2 = 1.08262617385222e-3;
        let point = Vec3::new(2.0*oblate.equatorial_radius_m,0.0,0.0);
        let point_mass = NBodySystem::new(vec![base.clone()]).unwrap().acceleration_at(point).unwrap();
        let j2_field = NBodySystem::new(vec![oblate.clone()]).unwrap().acceleration_at(point).unwrap();
        assert!(j2_field.x < point_mass.x);
        let polar = Vec3::new(0.0,0.0,2.0*oblate.equatorial_radius_m);
        let point_mass_polar = NBodySystem::new(vec![base]).unwrap().acceleration_at(polar).unwrap();
        let j2_polar = NBodySystem::new(vec![oblate]).unwrap().acceleration_at(polar).unwrap();
        assert!(j2_polar.z > point_mass_polar.z);
    }

    #[test]
    fn j2_pair_interaction_preserves_linear_momentum() {
        let system = NBodySystem::new(vec![
            NBody { id:"oblate".into(),mass_kg:5.0e24,collision_radius_m:6.0e6,equatorial_radius_m:6.1e6,
                j2:1.0e-3,pole_axis:Vec3::new(0.0,0.0,1.0),position:Vec3::new(0.0,0.0,0.0),velocity:Vec3::new(0.0,0.0,0.0) },
            NBody { id:"probe".into(),mass_kg:1.0e20,collision_radius_m:1.0e5,equatorial_radius_m:1.0e5,
                j2:0.0,pole_axis:Vec3::new(0.0,0.0,1.0),position:Vec3::new(1.0e9,2.0e8,0.0),velocity:Vec3::new(0.0,0.0,0.0) },
        ]).unwrap();
        let before = system.total_momentum();
        let scale = system.bodies().iter().map(|body|body.mass_kg*body.velocity.norm()).sum::<f64>().max(1.0);
        let mut advanced = system.clone();
        advanced.step(10.0).unwrap();
        assert!((advanced.total_momentum().sub(before)).norm()/scale < 1.0e-14);
        assert!(advanced.total_energy().unwrap().is_finite());
    }

    #[test]
    fn pairwise_forces_preserve_total_momentum_to_roundoff() {
        let mut system = circular_pair();
        let initial = system.total_momentum();
        for _ in 0..1000 { system.step(60.0).unwrap(); }
        let final_momentum = system.total_momentum();
        let scale = system.bodies().iter().map(|body| body.mass_kg * body.velocity.norm()).sum::<f64>().max(1.0);
        assert!(final_momentum.sub(initial).norm() / scale < 1.0e-12);
    }

    #[test]
    fn leapfrog_bounds_energy_error_over_one_orbit() {
        let mut system = circular_pair();
        let initial = system.total_energy().unwrap();
        let period = std::f64::consts::TAU * (1.495978707e11_f64.powi(3)
            / (G * (1.98847e30 + 5.9722e24))).sqrt();
        for _ in 0..(period / 300.0).ceil() as usize { system.step(300.0).unwrap(); }
        let final_energy = system.total_energy().unwrap();
        assert!(((final_energy - initial) / initial).abs() < 2.0e-7);
    }

    #[test]
    fn reverse_step_recovers_initial_state_within_roundoff() {
        let mut system = circular_pair();
        let initial = system.clone();
        for _ in 0..100 { system.step(120.0).unwrap(); }
        for _ in 0..100 { system.step(-120.0).unwrap(); }
        for (actual, expected) in system.bodies().iter().zip(initial.bodies()) {
            assert!(actual.position.sub(expected.position).norm() < 0.05);
            assert!(actual.velocity.sub(expected.velocity).norm() < 1.0e-6);
        }
    }

    #[test]
    fn adaptive_step_doubling_reduces_large_trial_steps_and_controls_error() {
        let system = circular_pair();
        let (adaptive, stats) = system.advanced_adaptive(
            5.0e6, 5.0e6, 1.0e-8, 1.0, 10_000
        ).unwrap();
        assert!(stats.rejected_steps > 0);
        assert!(stats.accepted_steps > 1);
        assert!(stats.maximum_normalized_error <= 1.0);
        assert!(stats.minimum_step_seconds < 5.0e6);
        assert!(adaptive.bodies().iter().all(|body| body.position.finite() && body.velocity.finite()));
    }

    #[test]
    fn adaptive_test_particle_reduces_steps_in_the_dynamic_gravity_field() {
        let start = circular_pair();
        let end = start.advanced_adaptive(600.0, 60.0, 1.0e-10, 1.0e-4, 10_000).unwrap().0;
        let earth = start.bodies().iter().find(|body| body.id == "earth").unwrap();
        let position = earth.position.add(Vec3::new(7.0e6, 0.0, 0.0));
        let velocity = earth.velocity.add(Vec3::new(0.0, 7.5e3, 0.0));
        let (p, v, stats) = NBodySystem::integrate_test_particle_adaptive(
            &start, &end, position, velocity, 600.0, 600.0, 1.0e-10, 1.0e-3, 10_000
        ).unwrap();
        assert!(stats.rejected_steps > 0);
        assert!(stats.accepted_steps > 1);
        assert!(stats.maximum_normalized_error <= 1.0);
        assert!(p.finite() && v.finite());
    }

    #[test]
    fn adaptive_collision_failure_does_not_mutate_the_source_system() {
        let system = NBodySystem::new(vec![
            NBody { id: "a".into(), mass_kg: 1.0, collision_radius_m: 1.0, equatorial_radius_m: 1.0, j2: 0.0, pole_axis: Vec3::new(0.0,0.0,1.0),
                position: Vec3::new(0.0,0.0,0.0), velocity: Vec3::new(0.0,0.0,0.0) },
            NBody { id: "b".into(), mass_kg: 1.0, collision_radius_m: 1.0, equatorial_radius_m: 1.0, j2: 0.0, pole_axis: Vec3::new(0.0,0.0,1.0),
                position: Vec3::new(1.0,0.0,0.0), velocity: Vec3::new(0.0,0.0,0.0) },
        ]).unwrap();
        let before = system.bodies()[0].position;
        assert!(system.advanced_adaptive(1.0, 1.0, 1.0e-8, 1.0e-3, 100).is_err());
        assert_eq!(system.bodies()[0].position, before);
    }

    #[test]
    fn collision_is_reported_instead_of_softened_or_silently_clamped() {
        let system = NBodySystem::new(vec![
            NBody { id: "a".into(), mass_kg: 1.0, collision_radius_m: 1.0, equatorial_radius_m: 1.0, j2: 0.0, pole_axis: Vec3::new(0.0,0.0,1.0),
                position: Vec3::new(0.0,0.0,0.0), velocity: Vec3::new(0.0,0.0,0.0) },
            NBody { id: "b".into(), mass_kg: 1.0, collision_radius_m: 1.0, equatorial_radius_m: 1.0, j2: 0.0, pole_axis: Vec3::new(0.0,0.0,1.0),
                position: Vec3::new(1.0,0.0,0.0), velocity: Vec3::new(0.0,0.0,0.0) },
        ]).unwrap();
        assert!(system.total_energy().is_err());
        let mut candidate = system.clone();
        let before = candidate.bodies()[0].position;
        assert!(candidate.step(1.0).is_err());
        assert_eq!(candidate.bodies()[0].position, before);
    }
}
