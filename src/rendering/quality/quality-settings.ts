import type { QualityLevel } from '../core/render-types.ts';

// Кожен профіль резервує пам'ять щонайменше для 20 сторінок: (resolution + 2*gutter)^2 * 13 байтів.
export interface GeodesicQualitySettings {pageResolution:number;meshResolution:number;gpuBudgetBytes:number;cpuBudgetBytes:number;workerCount:number;uploadsPerFrame:number;}
export const GEODESIC_QUALITY_PRESETS:Readonly<Record<QualityLevel,GeodesicQualitySettings>>=Object.freeze({
 low:{pageResolution:64,meshResolution:32,gpuBudgetBytes:8*1024*1024,cpuBudgetBytes:24*1024*1024,workerCount:1,uploadsPerFrame:1},
 medium:{pageResolution:96,meshResolution:48,gpuBudgetBytes:16*1024*1024,cpuBudgetBytes:48*1024*1024,workerCount:2,uploadsPerFrame:2},
 high:{pageResolution:128,meshResolution:64,gpuBudgetBytes:32*1024*1024,cpuBudgetBytes:96*1024*1024,workerCount:2,uploadsPerFrame:2},
 ultra:{pageResolution:160,meshResolution:64,gpuBudgetBytes:48*1024*1024,cpuBudgetBytes:128*1024*1024,workerCount:3,uploadsPerFrame:2}
});
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
  msaaSamples: number;
  maxMeshLod: number;
  textureQuality: QualityLevel;
  geodesic:GeodesicQualitySettings;
}

export const GRAPHICS_PRESETS: Readonly<Record<QualityLevel,GraphicsSettings>> = Object.freeze({
  low:{
    preset:'low',geodesic:GEODESIC_QUALITY_PRESETS.low,shadows:true,shadowMapSize:256,shadowOccluders:2,
    atmosphere:true,atmosphereIntensity:0.62,atmosphereSamples:4,clouds:false,cloudDetail:1,
    bloom:false,bloomThreshold:1.9,bloomStrength:0.18,bloomIterations:1,
    glare:false,glareStrength:0.12,lensFlare:false,lensFlareStrength:0.18,
    hdr:false,exposure:1.0,renderScale:0.72,msaaSamples:0,maxMeshLod:0,textureQuality:'low'
  },
  medium:{
    preset:'medium',geodesic:GEODESIC_QUALITY_PRESETS.medium,shadows:true,shadowMapSize:512,shadowOccluders:4,
    atmosphere:true,atmosphereIntensity:0.78,atmosphereSamples:6,clouds:true,cloudDetail:2,
    bloom:true,bloomThreshold:0.76,bloomStrength:0.24,bloomIterations:2,
    glare:false,glareStrength:0.2,lensFlare:false,lensFlareStrength:0.22,
    hdr:false,exposure:1.0,renderScale:0.88,msaaSamples:2,maxMeshLod:2,textureQuality:'medium'
  },
  high:{
    preset:'high',geodesic:GEODESIC_QUALITY_PRESETS.high,shadows:true,shadowMapSize:1024,shadowOccluders:6,
    atmosphere:true,atmosphereIntensity:0.92,atmosphereSamples:10,clouds:true,cloudDetail:3,
    bloom:true,bloomThreshold:1.45,bloomStrength:0.42,bloomIterations:4,
    glare:true,glareStrength:0.28,lensFlare:true,lensFlareStrength:0.32,
    hdr:true,exposure:1.0,renderScale:1,msaaSamples:4,maxMeshLod:3,textureQuality:'high'
  },
  ultra:{
    preset:'ultra',geodesic:GEODESIC_QUALITY_PRESETS.ultra,shadows:true,shadowMapSize:2048,shadowOccluders:8,
    atmosphere:true,atmosphereIntensity:1.0,atmosphereSamples:16,clouds:true,cloudDetail:4,
    bloom:true,bloomThreshold:1.32,bloomStrength:0.56,bloomIterations:6,
    glare:true,glareStrength:0.42,lensFlare:true,lensFlareStrength:0.46,
    hdr:true,exposure:1.08,renderScale:1,msaaSamples:4,maxMeshLod:3,textureQuality:'ultra'
  }
});

export const createGraphicsSettings=(preset:QualityLevel='high'):GraphicsSettings=>({...GRAPHICS_PRESETS[preset]});
