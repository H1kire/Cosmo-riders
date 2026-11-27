/**
 * Фізичні функції розсіювання атмосфери для активного WebGPU-рендерера.
 * Усі відстані в WGSL нормалізовані на середній радіус планети.
 */
export function rayleighPhase(cosine: number): number {
  const c = Math.max(-1, Math.min(1, cosine));
  return 3 / (16 * Math.PI) * (1 + c * c);
}

export function miePhase(cosine: number, anisotropy: number): number {
  const c = Math.max(-1, Math.min(1, cosine));
  const g = Math.max(-0.95, Math.min(0.95, anisotropy));
  const denominator = Math.max(1e-6, 1 + g * g - 2 * g * c);
  return (1 - g * g) / (4 * Math.PI * Math.pow(denominator, 1.5));
}

export function exponentialDensity(altitudeM: number, scaleHeightM: number): number {
  if (!Number.isFinite(altitudeM) || !Number.isFinite(scaleHeightM) || scaleHeightM <= 0) return 0;
  return Math.exp(-Math.max(0, altitudeM) / scaleHeightM);
}

export function atmosphereScaleHeightRatio(scaleHeightM: number, radiusM: number): number {
  if (!Number.isFinite(scaleHeightM) || !Number.isFinite(radiusM) || scaleHeightM <= 0 || radiusM <= 0) {
    throw new RangeError('Atmosphere scale height and body radius must be positive finite values.');
  }
  return Math.max(1e-6, Math.min(0.25, scaleHeightM / radiusM));
}

export const WEBGPU_ATMOSPHERE_WGSL = `
fn rayleighPhase(cosine: f32) -> f32 {
  return 3.0 / (16.0 * 3.14159265) * (1.0 + cosine * cosine);
}

fn miePhase(cosine: f32, anisotropy: f32) -> f32 {
  let g = clamp(anisotropy, -0.95, 0.95);
  let denominator = max(0.000001, 1.0 + g * g - 2.0 * g * cosine);
  return (1.0 - g * g) / (4.0 * 3.14159265 * pow(denominator, 1.5));
}

fn atmosphereDensity(altitude: f32, scaleHeight: f32) -> f32 {
  return exp(-max(0.0, altitude) / max(scaleHeight, 0.000001));
}

fn raySphereInterval(origin: vec3<f32>, direction: vec3<f32>, radius: f32) -> vec2<f32> {
  let b = dot(origin, direction);
  let c = dot(origin, origin) - radius * radius;
  let discriminant = b * b - c;
  if (discriminant < 0.0) { return vec2<f32>(-1.0, -1.0); }
  let root = sqrt(max(0.0, discriminant));
  return vec2<f32>(-b - root, -b + root);
}

fn atmosphereScattering(worldPosition: vec3<f32>, worldNormal: vec3<f32>) -> vec4<f32> {
  let center = body.model[3].xyz;
  let atmosphereRatio = clamp(body.material.z, 0.00001, 0.25);
  let outerRadius = max(length(body.model[0].xyz), 0.0000001);
  // Shell-модель уже масштабована до зовнішнього радіуса; відновлюємо радіус поверхні.
  let planetRadius = outerRadius / (1.0 + atmosphereRatio);
  let cameraOffset = body.cameraPosition.xyz - center;
  let viewRay = normalize(worldPosition - body.cameraPosition.xyz);

  // Малюємо лише ближню оболонку: задня половина не повинна подвоювати яскравість.
  if (dot(normalize(worldNormal), viewRay) > 0.001) { discard; }

  let outerInterval = raySphereInterval(cameraOffset, viewRay, outerRadius);
  if (outerInterval.y <= 0.0) { discard; }
  let startDistance = max(0.0, outerInterval.x);
  let groundInterval = raySphereInterval(cameraOffset, viewRay, planetRadius);
  var endDistance = outerInterval.y;
  if (groundInterval.x > startDistance) { endDistance = min(endDistance, groundInterval.x); }
  let pathLength = max(0.0, endDistance - startDistance);
  if (pathLength <= 0.0000001) { discard; }

  let rayleighScale = planetRadius * clamp(body.surfaceParams.y, 0.000001, 0.25);
  let mieScale = planetRadius * clamp(body.surfaceParams.z, 0.000001, 0.25);
  let samples = u32(clamp(body.surfaceParams.w, 2.0, 16.0));
  let stepLength = pathLength / f32(samples);
  let lightDirection = normalize(body.sunPosition.xyz - center);
  let cosineAngle = clamp(dot(viewRay, lightDirection), -1.0, 1.0);
  let phaseR = rayleighPhase(cosineAngle);
  let phaseM = miePhase(cosineAngle, body.surfaceParams.x);
  let spectralTint = clamp(body.color.rgb, vec3<f32>(0.02), vec3<f32>(1.0));
  let betaR = vec3<f32>(0.006, 0.018, 0.055) * spectralTint;
  let betaM = vec3<f32>(0.018, 0.016, 0.013) * max(0.0, body.material.w);

  var viewDepthR = 0.0;
  var viewDepthM = 0.0;
  var radiance = vec3<f32>(0.0);
  for (var index = 0u; index < 16u; index = index + 1u) {
    if (index >= samples) { break; }
    let distanceAlong = startDistance + (f32(index) + 0.5) * stepLength;
    let samplePosition = body.cameraPosition.xyz + viewRay * distanceAlong;
    let altitude = max(0.0, length(samplePosition - center) - planetRadius);
    let densityR = atmosphereDensity(altitude, rayleighScale);
    let densityM = atmosphereDensity(altitude, mieScale);
    viewDepthR += densityR * stepLength / planetRadius;
    viewDepthM += densityM * stepLength / planetRadius;

    let toSun = body.sunPosition.xyz - samplePosition;
    let sunDistance = length(toSun);
    let sunDirection = toSun / max(sunDistance, 0.0000001);
    let groundShadow = raySphereInterval(samplePosition - center, sunDirection, planetRadius);
    var sunlightVisibility = 1.0;
    if (groundShadow.x > 0.00001) { sunlightVisibility = 0.0; }
    sunlightVisibility *= surfaceShadowVisibility(samplePosition);

    // Чотири кроки оцінюють оптичну товщу на шляху сонячного променя.
    let sunInterval = raySphereInterval(samplePosition - center, sunDirection, outerRadius);
    let sunEnd = max(0.0, sunInterval.y);
    var sunDepthR = 0.0;
    var sunDepthM = 0.0;
    for (var lightStep = 0u; lightStep < 4u; lightStep = lightStep + 1u) {
      let lightDistance = (f32(lightStep) + 0.5) * sunEnd / 4.0;
      let lightPosition = samplePosition + sunDirection * lightDistance;
      let lightAltitude = max(0.0, length(lightPosition - center) - planetRadius);
      sunDepthR += atmosphereDensity(lightAltitude, rayleighScale) * sunEnd / (4.0 * planetRadius);
      sunDepthM += atmosphereDensity(lightAltitude, mieScale) * sunEnd / (4.0 * planetRadius);
    }

    let transmittance = exp(-betaR * (viewDepthR + sunDepthR) - betaM * (viewDepthM + sunDepthM));
    let source = betaR * densityR * phaseR + betaM * densityM * phaseM;
    radiance += source * transmittance * sunlightVisibility * (stepLength / planetRadius);
  }

  let intensity = max(0.0, body.material.y);
  let color = radiance * intensity * 18.0;
  let optical = dot(radiance, vec3<f32>(0.2126, 0.7152, 0.0722));
  let alpha = clamp((1.0 - exp(-optical * intensity * 22.0)) * 0.78, 0.0, 0.78);
  return vec4<f32>(color, alpha);
}
`;
