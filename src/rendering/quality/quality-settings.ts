import type { QualityLevel } from '../core/render-types.ts';

export interface GraphicsSettings {
  preset: QualityLevel;
  shadows: boolean;
  shadowMapSize: number;
  shadowOccluders: number;
  atmosphere: boolean;
  atmosphereIntensity: number;
  atmosphereSamples: number;
  clouds: boolean;
  cloudDetail: number;
  bloom: boolean;
  bloomThreshold: number;
  bloomStrength: number;
  bloomIterations: number;
  glare: boolean;
  glareStrength: number;
  lensFlare: boolean;
  lensFlareStrength: number;
  hdr: boolean;
  exposure: number;
  renderScale: number;
  maxMeshLod: number;
  textureQuality: QualityLevel;
}

export const GRAPHICS_PRESETS: Readonly<Record<QualityLevel,GraphicsSettings>> = Object.freeze({
  low:{
    preset:'low',shadows:true,shadowMapSize:256,shadowOccluders:2,
    atmosphere:true,atmosphereIntensity:0.62,atmosphereSamples:4,clouds:false,cloudDetail:1,
    bloom:false,bloomThreshold:1.9,bloomStrength:0.18,bloomIterations:1,
    glare:false,glareStrength:0.12,lensFlare:false,lensFlareStrength:0.18,
    hdr:false,exposure:1.0,renderScale:0.72,maxMeshLod:0,textureQuality:'low'
  },
  medium:{
    preset:'medium',shadows:true,shadowMapSize:512,shadowOccluders:4,
    atmosphere:true,atmosphereIntensity:0.78,atmosphereSamples:6,clouds:true,cloudDetail:2,
    bloom:true,bloomThreshold:0.76,bloomStrength:0.24,bloomIterations:2,
    glare:false,glareStrength:0.2,lensFlare:false,lensFlareStrength:0.22,
    hdr:false,exposure:1.0,renderScale:0.88,maxMeshLod:2,textureQuality:'medium'
  },
  high:{
    preset:'high',shadows:true,shadowMapSize:1024,shadowOccluders:6,
    atmosphere:true,atmosphereIntensity:0.92,atmosphereSamples:8,clouds:true,cloudDetail:3,
    bloom:true,bloomThreshold:1.45,bloomStrength:0.42,bloomIterations:4,
    glare:true,glareStrength:0.28,lensFlare:true,lensFlareStrength:0.32,
    hdr:true,exposure:1.0,renderScale:1,maxMeshLod:3,textureQuality:'high'
  },
  ultra:{
    preset:'ultra',shadows:true,shadowMapSize:2048,shadowOccluders:8,
    atmosphere:true,atmosphereIntensity:1.0,atmosphereSamples:12,clouds:true,cloudDetail:4,
    bloom:true,bloomThreshold:1.32,bloomStrength:0.56,bloomIterations:6,
    glare:true,glareStrength:0.42,lensFlare:true,lensFlareStrength:0.46,
    hdr:true,exposure:1.08,renderScale:1,maxMeshLod:3,textureQuality:'ultra'
  }
});

export const createGraphicsSettings=(preset:QualityLevel='high'):GraphicsSettings=>({...GRAPHICS_PRESETS[preset]});
