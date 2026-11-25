use crate::physics::Vec3;

const G: f64 = 6.67430e-11;

#[derive(Clone, Debug)]
pub struct NBody {
    pub id: String,
    pub mass_kg: f64,
    pub collision_radius_m: f64,
    pub position: Vec3,
    pub velocity: Vec3,
}

#[derive(Clone, Debug)]
pub struct NBodySystem {
    bodies: Vec<NBody>,
}

impl NBodySystem {
    pub fn new(bodies: Vec<NBody>) -> Result<Self, String> {
        if bodies.is_empty() {
            return Err("N-body system must contain at least one body.".into());
        }
        let mut ids = std::collections::HashSet::with_capacity(bodies.len());
        for body in &bodies {
            if body.id.trim().is_empty() || !ids.insert(body.id.clone()) {
                return Err("N-body identifiers must be non-empty and unique.".into());
            }
            if !body.mass_kg.is_finite() || body.mass_kg <= 0.0 {
                return Err(format!("Invalid mass for {}.", body.id));
            }
            if !body.collision_radius_m.is_finite() || body.collision_radius_m < 0.0 {
                return Err(format!("Invalid collision radius for {}.", body.id));
            }
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
            NBody { id: "sun".into(), mass_kg: sun_mass, collision_radius_m: 6.957e8,
                position: Vec3::new(sun_r, 0.0, 0.0), velocity: Vec3::new(0.0, sun_v, 0.0) },
            NBody { id: "earth".into(), mass_kg: planet_mass, collision_radius_m: 6.371e6,
                position: Vec3::new(planet_r, 0.0, 0.0), velocity: Vec3::new(0.0, planet_v, 0.0) },
        ]).unwrap()
    }

    #[test]
    fn pairwise_forces_preserve_total_momentum_to_roundoff() {
        let mut system = circular_pair();
        let initial = system.total_momentum();
        for _ in 0..1000 { system.step(60.0).unwrap(); }
        let final_momentum = system.total_momentum();
        let scale = initial.norm().max(1.0);
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
    fn collision_is_reported_instead_of_softened_or_silently_clamped() {
        let system = NBodySystem::new(vec![
            NBody { id: "a".into(), mass_kg: 1.0, collision_radius_m: 1.0,
                position: Vec3::new(0.0,0.0,0.0), velocity: Vec3::new(0.0,0.0,0.0) },
            NBody { id: "b".into(), mass_kg: 1.0, collision_radius_m: 1.0,
                position: Vec3::new(1.0,0.0,0.0), velocity: Vec3::new(0.0,0.0,0.0) },
        ]).unwrap();
        assert!(system.total_energy().is_err());
        assert!(system.clone().step(1.0).is_err());
    }
}
