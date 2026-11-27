/**
 * Профілі зональної циркуляції та великих атмосферних вихорів газових гігантів.
 * Типи є стабільними числовими кодами, що передаються до WGSL.
 */
export interface GasGiantProfile {
  type: number;
  bandStrength: number;
  stormStrength: number;
  jetCount: number;
}

const GAS_GIANT_PROFILES: Record<string, GasGiantProfile> = {
  jupiter: { type: 1, bandStrength: 1.0, stormStrength: 0.96, jetCount: 14 },
  saturn: { type: 2, bandStrength: 0.82, stormStrength: 0.62, jetCount: 12 },
  uranus: { type: 3, bandStrength: 0.46, stormStrength: 0.38, jetCount: 8 },
  neptune: { type: 4, bandStrength: 0.76, stormStrength: 0.84, jetCount: 10 }
};

export function gasGiantProfileForId(bodyId: string): GasGiantProfile | null {
  const profile = GAS_GIANT_PROFILES[bodyId.toLowerCase()];
  return profile ? { ...profile } : null;
}
