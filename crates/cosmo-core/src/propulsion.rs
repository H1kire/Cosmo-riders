use crate::physics::Vec3;

const STANDARD_GRAVITY: f64 = 9.80665;
const FUEL_EPSILON_KG: f64 = 1.0e-12;

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Engine {
    pub id: String,
    pub name: String,
    pub max_thrust_n: f64,
    pub isp_seconds: f64,
    pub direction: [f64; 3],
    #[serde(default)]
    pub mount_position_m: [f64; 3],
    #[serde(default)]
    pub throttle: f64,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub propellant_kg: f64,
    #[serde(default)]
    pub burn_remaining_seconds: Option<f64>,
}

impl Engine {
    pub fn validate(&mut self) -> Result<(), String> {
        if self.id.trim().is_empty() || self.name.trim().is_empty() {
            return Err("Engine id and name must be non-empty.".into());
        }
        if !self.max_thrust_n.is_finite() || self.max_thrust_n <= 0.0 {
            return Err("maxThrustN must be finite and positive.".into());
        }
        if !self.isp_seconds.is_finite() || self.isp_seconds <= 0.0 {
            return Err("ispSeconds must be finite and positive.".into());
        }
        if !self.throttle.is_finite() || !(0.0..=1.0).contains(&self.throttle) {
            return Err("throttle must be in [0, 1].".into());
        }
        if self.burn_remaining_seconds.map(|x| !x.is_finite() || x < 0.0).unwrap_or(false) {
            return Err("burnRemainingSeconds must be finite and non-negative.".into());
        }
        if !self.propellant_kg.is_finite() || self.propellant_kg < 0.0 {
            return Err("propellantKg must be finite and non-negative.".into());
        }
        if !self.direction.iter().all(|x| x.is_finite())
            || !self.mount_position_m.iter().all(|x| x.is_finite())
        {
            return Err("Engine vectors must be finite.".into());
        }
        let direction = Vec3::new(self.direction[0], self.direction[1], self.direction[2])
            .normalized()?;
        self.direction = [direction.x, direction.y, direction.z];
        Ok(())
    }

    fn active(&self) -> bool {
        self.enabled && self.throttle > 0.0 && self.propellant_kg > FUEL_EPSILON_KG && self.burn_remaining_seconds != Some(0.0)
    }
}

#[derive(Clone, Copy, Debug)]
pub struct PropulsionDiagnostics {
    pub thrust_n: f64,
    pub mass_flow_kg_s: f64,
    pub acceleration_m_s2: f64,
    pub propellant_used_kg: f64,
}

#[derive(Clone, Copy)]
struct Derivative {
    position: Vec3,
    velocity: Vec3,
    mass: f64,
}

fn derivative(
    position: Vec3,
    velocity: Vec3,
    mass: f64,
    force: Vec3,
    mass_flow: f64,
    gravity: &impl Fn(Vec3) -> Result<Vec3, String>,
) -> Result<Derivative, String> {
    if !mass.is_finite() || mass <= 0.0 {
        return Err("Vessel mass became non-positive during propulsion integration.".into());
    }
    let acceleration = gravity(position)?.add(force.scale(1.0 / mass));
    if !acceleration.finite() {
        return Err("Propulsion integration produced non-finite acceleration.".into());
    }
    Ok(Derivative { position: velocity, velocity: acceleration, mass: -mass_flow })
}

fn add_scaled(
    position: Vec3,
    velocity: Vec3,
    mass: f64,
    d: Derivative,
    scale: f64,
) -> (Vec3, Vec3, f64) {
    (
        position.add(d.position.scale(scale)),
        velocity.add(d.velocity.scale(scale)),
        mass + d.mass * scale,
    )
}

/// Integrates one fixed physics interval with RK4. Fuel-depletion events split the
/// interval so an engine never produces thrust after its own propellant is exhausted.
pub fn integrate_engines(
    position: &mut Vec3,
    velocity: &mut Vec3,
    mass: &mut f64,
    engines: &mut [Engine],
    dt: f64,
    gravity: impl Fn(Vec3) -> Result<Vec3, String>,
) -> Result<PropulsionDiagnostics, String> {
    if !dt.is_finite() || dt < 0.0 {
        return Err("Propulsion delta time must be finite and non-negative.".into());
    }
    if !mass.is_finite() || *mass <= 0.0 || !position.finite() || !velocity.finite() {
        return Err("Initial vessel state must be finite with positive mass.".into());
    }
    if dt == 0.0 {
        return Ok(PropulsionDiagnostics { thrust_n: 0.0, mass_flow_kg_s: 0.0, acceleration_m_s2: 0.0, propellant_used_kg: 0.0 });
    }

    let mut remaining = dt;
    let mut used_total = 0.0;
    let mut peak_thrust: f64 = 0.0;
    let mut peak_flow: f64 = 0.0;
    let mut peak_acceleration: f64 = 0.0;
    let mut event_iterations = 0_u32;

    while remaining > dt.max(1.0) * 1.0e-14 {
        event_iterations += 1;
        if event_iterations > 128 {
            return Err("Too many engine depletion events in one physics step.".into());
        }

        let mut force = Vec3::new(0.0, 0.0, 0.0);
        let mut flow = 0.0;
        let mut next_event = remaining;
        for engine in engines.iter() {
            if !engine.active() { continue; }
            let thrust = engine.max_thrust_n * engine.throttle;
            let direction = Vec3::new(engine.direction[0], engine.direction[1], engine.direction[2]);
            force = force.add(direction.scale(thrust));
            let engine_flow = thrust / (engine.isp_seconds * STANDARD_GRAVITY);
            flow += engine_flow;
            next_event = next_event.min(engine.propellant_kg / engine_flow);
            if let Some(remaining_burn) = engine.burn_remaining_seconds { next_event = next_event.min(remaining_burn); }
        }
        let h = next_event.max(0.0).min(remaining);
        peak_acceleration = peak_acceleration.max(gravity(*position)?.add(force.scale(1.0 / *mass)).norm());
        if h <= 0.0 {
            for engine in engines.iter_mut() {
                if engine.propellant_kg <= FUEL_EPSILON_KG { engine.propellant_kg = 0.0; }
            }
            continue;
        }

        let p0 = *position;
        let v0 = *velocity;
        let m0 = *mass;
        let k1 = derivative(p0, v0, m0, force, flow, &gravity)?;
        let (p2, v2, m2) = add_scaled(p0, v0, m0, k1, h * 0.5);
        let k2 = derivative(p2, v2, m2, force, flow, &gravity)?;
        let (p3, v3, m3) = add_scaled(p0, v0, m0, k2, h * 0.5);
        let k3 = derivative(p3, v3, m3, force, flow, &gravity)?;
        let (p4, v4, m4) = add_scaled(p0, v0, m0, k3, h);
        let k4 = derivative(p4, v4, m4, force, flow, &gravity)?;

        let weighted = |a: Vec3, b: Vec3, c: Vec3, d: Vec3| {
            a.add(b.scale(2.0)).add(c.scale(2.0)).add(d).scale(h / 6.0)
        };
        *position = p0.add(weighted(k1.position, k2.position, k3.position, k4.position));
        *velocity = v0.add(weighted(k1.velocity, k2.velocity, k3.velocity, k4.velocity));
        let mass_delta = weighted(
            Vec3::new(k1.mass, 0.0, 0.0),
            Vec3::new(k2.mass, 0.0, 0.0),
            Vec3::new(k3.mass, 0.0, 0.0),
            Vec3::new(k4.mass, 0.0, 0.0),
        ).x;
        *mass = (m0 + mass_delta).max(0.0);

        if flow > 0.0 {
            let mut consumed = 0.0;
            for engine in engines.iter_mut() {
                if !engine.active() { continue; }
                if let Some(remaining_burn) = engine.burn_remaining_seconds {
                    let left = (remaining_burn - h).max(0.0);
                    engine.burn_remaining_seconds = Some(left);
                    if left <= 1.0e-12 { engine.burn_remaining_seconds = Some(0.0); engine.enabled = false; }
                }
                let thrust = engine.max_thrust_n * engine.throttle;
                let engine_flow = thrust / (engine.isp_seconds * STANDARD_GRAVITY);
                let amount = (engine_flow * h).min(engine.propellant_kg);
                engine.propellant_kg = (engine.propellant_kg - amount).max(0.0);
                if engine.propellant_kg <= FUEL_EPSILON_KG { engine.propellant_kg = 0.0; }
                consumed += amount;
            }
            *mass = (m0 - consumed).max(f64::MIN_POSITIVE);
            used_total += consumed;
        }
        peak_thrust = peak_thrust.max(force.norm());
        peak_flow = peak_flow.max(flow);

        remaining = (remaining - h).max(0.0);
    }

    if !position.finite() || !velocity.finite() || !mass.is_finite() || *mass <= 0.0 {
        return Err("Propulsion integration produced an invalid vessel state.".into());
    }
    Ok(PropulsionDiagnostics {
        thrust_n: peak_thrust,
        mass_flow_kg_s: peak_flow,
        acceleration_m_s2: peak_acceleration,
        propellant_used_kg: used_total,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vacuum_burn_matches_rocket_equation_and_fuel_flow() {
        let mut p = Vec3::new(0.0, 0.0, 0.0);
        let mut v = Vec3::new(0.0, 0.0, 0.0);
        let mut mass = 100.0;
        let mut engines = vec![Engine {
            id: "main".into(), name: "Main".into(), max_thrust_n: 100.0,
            isp_seconds: 300.0, direction: [1.0, 0.0, 0.0],
            mount_position_m: [0.0; 3], throttle: 1.0, enabled: true, propellant_kg: 10.0, burn_remaining_seconds: None,
        }];
        let result = integrate_engines(&mut p, &mut v, &mut mass, &mut engines, 20.0, |_| Ok(Vec3::new(0.0, 0.0, 0.0))).unwrap();
        let expected_mass = 100.0 - 100.0 / (300.0 * STANDARD_GRAVITY) * 20.0;
        let expected_dv = 300.0 * STANDARD_GRAVITY * (100.0 / expected_mass).ln();
        assert!((mass - expected_mass).abs() < 1.0e-10);
        assert!((v.x - expected_dv).abs() < 1.0e-8);
        assert!((result.propellant_used_kg - (100.0 - expected_mass)).abs() < 1.0e-10);
    }

    #[test]
    fn engine_stops_at_fuel_depletion_inside_step() {
        let mut p = Vec3::new(0.0, 0.0, 0.0);
        let mut v = Vec3::new(0.0, 0.0, 0.0);
        let mut mass = 10.1;
        let mut engines = vec![Engine {
            id: "ion".into(), name: "Ion".into(), max_thrust_n: 10.0,
            isp_seconds: 1000.0, direction: [0.0, 1.0, 0.0],
            mount_position_m: [0.0; 3], throttle: 1.0, enabled: true, propellant_kg: 0.1,
        }];
        integrate_engines(&mut p, &mut v, &mut mass, &mut engines, 100.0, |_| Ok(Vec3::new(0.0, 0.0, 0.0))).unwrap();
        assert_eq!(engines[0].propellant_kg, 0.0);
        assert!((mass - 10.0).abs() < 1.0e-10);
        assert!(v.y > 0.0);
    }

    #[test]
    fn commanded_burn_duration_splits_the_step_and_shuts_engine_down() {
        let mut p = Vec3::new(0.0, 0.0, 0.0);
        let mut v = Vec3::new(0.0, 0.0, 0.0);
        let mut mass = 100.0;
        let mut engines = vec![Engine {
            id: "main".into(), name: "Main".into(), max_thrust_n: 100.0,
            isp_seconds: 300.0, direction: [1.0, 0.0, 0.0],
            mount_position_m: [0.0; 3], throttle: 1.0, enabled: true,
            propellant_kg: 10.0, burn_remaining_seconds: Some(2.0),
        }];
        let result = integrate_engines(&mut p, &mut v, &mut mass, &mut engines, 10.0, |_| Ok(Vec3::new(0.0, 0.0, 0.0))).unwrap();
        assert!(!engines[0].enabled);
        assert_eq!(engines[0].burn_remaining_seconds, Some(0.0));
        assert!(engines[0].propellant_kg > 9.9);
        assert!(result.propellant_used_kg < 0.1);
        assert!(v.x > 1.9 && v.x < 2.1);
    }

    #[test]
    fn multiple_engines_sum_force_and_mass_flow() {
        let mut p = Vec3::new(0.0, 0.0, 0.0);
        let mut v = Vec3::new(0.0, 0.0, 0.0);
        let mut mass = 100.0;
        let mut engines = vec![
            Engine { id:"a".into(),name:"A".into(),max_thrust_n:100.0,isp_seconds:200.0,direction:[1.0,0.0,0.0],mount_position_m:[0.0;3],throttle:1.0,enabled:true,propellant_kg:10.0,burn_remaining_seconds:None },
            Engine { id:"b".into(),name:"B".into(),max_thrust_n:50.0,isp_seconds:400.0,direction:[0.0,1.0,0.0],mount_position_m:[0.0;3],throttle:0.5,enabled:true,propellant_kg:10.0,burn_remaining_seconds:None },
        ];
        let result=integrate_engines(&mut p,&mut v,&mut mass,&mut engines,1.0, |_| Ok(Vec3::new(0.0,0.0,0.0))).unwrap();
        assert!((result.thrust_n - (100.0_f64.powi(2)+25.0_f64.powi(2)).sqrt()).abs()<1.0e-10);
        assert!(result.mass_flow_kg_s>0.0);
        assert!(v.x>0.0&&v.y>0.0);
    }
}
