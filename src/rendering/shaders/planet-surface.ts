export const PLANET_SURFACE_VERTEX = `attribute vec3 aPosition;
attribute vec3 aNormal;
uniform mat4 uViewProjection;
uniform mat4 uModel;
uniform float uKind;
uniform float uDetail;
uniform float uSeed;
uniform float uUseGeneratedMaps;
uniform samplerCube uGeneratedHeight;
uniform samplerCube uPreviousHeight;
uniform float uPreviousMapsEnabled;
uniform float uTectonicActivity;
uniform float uVolcanicActivity;
varying vec3 vNormal;
varying vec3 vSurfaceDirection;
varying vec3 vPosition;

float hash31(vec3 p){
  p=fract(p*0.3183099+0.1);
  p*=17.0;
  return fract(p.x*p.y*p.z*(p.x+p.y+p.z));
}
float noise3(vec3 p){
  vec3 i=floor(p),f=fract(p);
  f=f*f*(3.0-2.0*f);
  return mix(
    mix(mix(hash31(i),hash31(i+vec3(1.,0.,0.)),f.x),
        mix(hash31(i+vec3(0.,1.,0.)),hash31(i+vec3(1.,1.,0.)),f.x),f.y),
    mix(mix(hash31(i+vec3(0.,0.,1.)),hash31(i+vec3(1.,0.,1.)),f.x),
        mix(hash31(i+vec3(0.,1.,1.)),hash31(i+vec3(1.,1.,1.)),f.x),f.y),f.z);
}
float fbm3(vec3 p){
  float value=0.0, amplitude=0.5;
  for(int i=0;i<5;i++){
    value+=noise3(p)*amplitude;
    p=p*2.03+vec3(17.1,9.2,13.7);
    amplitude*=0.5;
  }
  return value;
}
float ridged3(vec3 p){
  float value=0.0,amplitude=0.5,norm=0.0;
  for(int i=0;i<5;i++){float ridge=1.0-abs(noise3(p));value+=ridge*ridge*amplitude;norm+=amplitude;p=p*2.07+vec3(11.3,23.7,5.9);amplitude*=0.5;}
  return value/max(norm,0.001);
}
vec3 domainWarp3(vec3 p){
  return p+vec3(noise3(p+vec3(17.1,-3.7,8.2)),noise3(p+vec3(-9.2,21.4,2.6)),noise3(p+vec3(4.8,6.1,-19.3)))*0.38;
}
void main(){
  vec3 n=normalize(aNormal);
  vec3 warped=domainWarp3(n*(18.0+uDetail*54.0)+uSeed);
  float terrain=fbm3(warped)+ridged3(warped*1.7)*uTectonicActivity*0.24+fbm3(n*31.0+uSeed*2.0)*uVolcanicActivity*0.08;
  float relief=0.0;
  if(uKind>0.5&&uKind<1.5) relief=(terrain-0.48)*0.0018*uDetail;
  else if(uKind>1.5&&uKind<2.5) relief=(terrain-0.48)*0.009*uDetail;
  float generatedHeight=textureLod(uGeneratedHeight,n,0.0).r-0.5;
  float mapBlend=uUseGeneratedMaps;
  if(uPreviousMapsEnabled>0.5){float previousHeight=textureLod(uPreviousHeight,n,0.0).r-0.5;generatedHeight=mix(previousHeight,generatedHeight,uUseGeneratedMaps);mapBlend=1.0;}
  float heightScale=uKind<1.5?0.009:(uKind<2.5?0.045:(uKind>4.9&&uKind<5.5?0.02:0.0));
  float generatedRelief=generatedHeight*heightScale*uDetail;
  relief=mix(relief,generatedRelief,mapBlend);
  vec4 world=uModel*vec4(aPosition*(1.0+relief),1.0);
  vPosition=world.xyz;
  vNormal=normalize(mat3(uModel)*n);
  vSurfaceDirection=n;
  gl_Position=uViewProjection*world;
}`;

export const PLANET_SURFACE_FRAGMENT = `precision highp float;
uniform vec3 uColor;
uniform vec3 uCameraPosition;
uniform mat4 uModel;
uniform vec3 uLightPositions[4];
uniform vec3 uLightColors[4];
uniform float uLightIntensities[4];
uniform int uLightCount;
uniform float uKind;
uniform float uDetail;
uniform float uSeed;
uniform float uWaterFraction;
uniform float uIceFraction;
uniform float uIronFraction;
uniform float uTectonicActivity;
uniform float uVolcanicActivity;
uniform float uErosion;
uniform samplerCube uGeneratedAlbedo;
uniform samplerCube uGeneratedNormal;
uniform samplerCube uGeneratedHeight;
uniform samplerCube uGeneratedRoughness;
uniform samplerCube uPreviousAlbedo;
uniform samplerCube uPreviousNormal;
uniform samplerCube uPreviousHeight;
uniform samplerCube uPreviousRoughness;
uniform float uPreviousMapsEnabled;
uniform float uUseGeneratedMaps;
uniform vec3 uSunPosition;
uniform float uSunRadius;
uniform vec3 uOccluders[8];
uniform float uOccluderRadii[8];
uniform int uOccluderCount;
uniform int uShadows;
uniform float uBodyExposure;
varying vec3 vNormal;
varying vec3 vSurfaceDirection;
varying vec3 vPosition;

const float PI=3.14159265359;
float hash31(vec3 p){
  p=fract(p*0.3183099+0.1);
  p*=17.0;
  return fract(p.x*p.y*p.z*(p.x+p.y+p.z));
}
float noise3(vec3 p){
  vec3 i=floor(p),f=fract(p);
  f=f*f*(3.0-2.0*f);
  return mix(
    mix(mix(hash31(i),hash31(i+vec3(1.,0.,0.)),f.x),
        mix(hash31(i+vec3(0.,1.,0.)),hash31(i+vec3(1.,1.,0.)),f.x),f.y),
    mix(mix(hash31(i+vec3(0.,0.,1.)),hash31(i+vec3(1.,0.,1.)),f.x),
        mix(hash31(i+vec3(0.,1.,1.)),hash31(i+vec3(1.,1.,1.)),f.x),f.y),f.z);
}
float fbm3(vec3 p){
  float value=0.0, amplitude=0.5;
  for(int i=0;i<6;i++){
    value+=noise3(p)*amplitude;
    p=p*2.03+vec3(17.1,9.2,13.7);
    amplitude*=0.5;
  }
  return value;
}
float ridged3(vec3 p){
  float value=0.0,amplitude=0.5,norm=0.0;
  for(int i=0;i<5;i++){float ridge=1.0-abs(noise3(p));value+=ridge*ridge*amplitude;norm+=amplitude;p=p*2.07+vec3(11.3,23.7,5.9);amplitude*=0.5;}
  return value/max(norm,0.001);
}
vec3 domainWarp3(vec3 p){
  return p+vec3(noise3(p+vec3(17.1,-3.7,8.2)),noise3(p+vec3(-9.2,21.4,2.6)),noise3(p+vec3(4.8,6.1,-19.3)))*0.38;
}
float fbm3Filtered(vec3 p){
  float footprint=max(max(fwidth(p.x),fwidth(p.y)),fwidth(p.z));
  float value=0.0,amplitude=0.5;
  for(int i=0;i<6;i++){
    float octaveWeight=1.0-smoothstep(0.32,0.92,footprint);
    value+=noise3(p)*amplitude*octaveWeight;
    p=p*2.03+vec3(17.1,9.2,13.7);
    footprint*=2.03;
    amplitude*=0.5;
  }
  return value;
}
float shadowVisibility(vec3 point){
  if(uShadows==0)return 1.0;
  vec3 toSun=uSunPosition-point;
  float sunDistance=length(toSun);
  vec3 ray=toSun/max(sunDistance,1e-12);
  float visibility=1.0;
  for(int i=0;i<8;i++){
    if(i<uOccluderCount){
      vec3 toBlocker=uOccluders[i]-point;
      float along=dot(toBlocker,ray);
      if(along>0.0&&along<sunDistance){
        float perpendicular=length(toBlocker-ray*along);
        float angularSun=uSunRadius*along/max(sunDistance-along,1e-12);
        float penumbra=uOccluderRadii[i]+angularSun;
        float umbra=max(0.0,uOccluderRadii[i]-angularSun);
        visibility*=smoothstep(umbra,max(umbra+1e-12,penumbra),perpendicular);
      }
    }
  }
  return clamp(visibility,0.0,1.0);
}
vec3 surfaceAlbedo(vec3 n,out float roughness,out float specular){
  vec3 warped=domainWarp3(n*3.1+uSeed);
  float broad=fbm3(warped);
  float medium=fbm3(domainWarp3(n*(7.0+uDetail*6.0)+uSeed*2.7));
  float fine=fbm3Filtered(n*(8.0+uDetail*42.0)+uSeed*5.1);
  float ridges=ridged3(warped*9.0);
  float tectonics=ridged3(domainWarp3(n*14.0+uSeed*3.1))*uTectonicActivity*(1.0-uErosion*0.55);
  float volcanic=fbm3(n*19.0+uSeed*7.3)*uVolcanicActivity;
  float cells=fbm3(n*47.0+uSeed*11.7);
  float latitude=abs(n.y);
  vec3 albedo=pow(uColor,vec3(2.2));
  roughness=0.82;
  specular=0.035;

  if(uKind<0.5){
    float granulation=fbm3Filtered(n*95.0+uSeed*7.0);
    float cells=sin((n.y*32.0+broad*4.0)*PI)*0.5+0.5;
    albedo=mix(vec3(0.30,0.075,0.018),vec3(1.0,0.53,0.16),0.55+0.35*cells+0.1*granulation);
    roughness=0.42;
    specular=0.0;
  }else if(uKind<1.5){
    float continentField=broad+(medium-0.5)*0.12+tectonics*0.09;
    float land=smoothstep(0.468,0.548,continentField);
    land=mix(land, smoothstep(0.46,0.56,continentField+ridged3(n*23.0+uSeed)*0.045),0.38);
    float coast=1.0-smoothstep(0.0,0.035,abs(continentField-0.505));
    float desert=smoothstep(0.42,0.67,medium+latitude*0.12+uIronFraction*0.08);
    vec3 ocean=mix(vec3(0.006,0.022,0.075),vec3(0.014,0.105,0.245),medium);
    vec3 vegetation=mix(vec3(0.035,0.095,0.028),vec3(0.17,0.27,0.082),fine);
    vec3 dryLand=mix(vec3(0.24,0.16,0.075),vec3(0.52,0.34,0.16),fine);
    vec3 landColor=mix(vegetation,dryLand,desert*0.72);
    landColor=mix(landColor,vec3(0.72,0.67,0.52),smoothstep(0.77,0.93,latitude));
    float oceanCoverage=clamp(uWaterFraction*1.35,0.0,1.0);
    albedo=mix(landColor,ocean,oceanCoverage*(1.0-land));
    albedo=mix(albedo,vec3(0.62,0.68,0.67),coast*0.28);
    float ice=smoothstep(0.86-uIceFraction*0.16,0.96-uIceFraction*0.12,latitude)*clamp(uIceFraction*2.5,0.0,1.0);
    albedo=mix(albedo,vec3(0.82,0.88,0.91),ice);
    roughness=mix(0.075,0.88,land);
    specular=mix(0.72,0.035,land);
  }else if(uKind<2.5){
    bool mars=uColor.r>0.6&&uColor.g<0.4;
    bool mercury=uColor.r<0.55&&uColor.g<0.55;
    bool io=uColor.r>uColor.g&&uColor.g>uColor.b*1.2;
    bool desert=uKind>2.3&&uKind<2.5;
    float craterNoise=fbm3Filtered(n*(18.0+uDetail*40.0)+uSeed*3.0)+ridged3(n*25.0+uSeed*9.0)*0.16;
    float craterRim=smoothstep(0.48,0.55,craterNoise)-smoothstep(0.55,0.63,craterNoise);
    float craterBasin=1.0-smoothstep(0.34,0.53,craterNoise);
    if(mars){
      vec3 rust=mix(vec3(0.16,0.035,0.018),vec3(0.56,0.16,0.065),broad);
      rust=mix(rust,vec3(0.29,0.095,0.045),medium*0.55);
      albedo=rust*(0.82+0.28*fine)+vec3(0.08,0.035,0.012)*uIronFraction*cells;
      albedo+=vec3(0.09,0.035,0.015)*craterRim;
      albedo*=1.0-0.22*craterBasin;
      albedo=mix(albedo,vec3(0.72,0.68,0.61),smoothstep(0.91,0.97,latitude)*clamp(uIceFraction*2.0,0.0,1.0));
    }else if(io){
      float sulfur=fbm3(n*vec3(17.0,23.0,17.0)+uSeed*5.0);
      float frost=ridged3(n*31.0+uSeed*2.0);
      albedo=mix(vec3(0.24,0.16,0.035),vec3(0.78,0.63,0.18),smoothstep(0.25,0.72,sulfur));
      albedo=mix(albedo,vec3(0.88,0.82,0.55),smoothstep(0.72,0.92,frost)*0.45);
    }else if(desert){
      float dunes=fbm3(domainWarp3(n*vec3(8.0,3.0,8.0)+uSeed));
      albedo=mix(vec3(0.25,0.105,0.045),vec3(0.68,0.34,0.13),dunes);
      albedo+=vec3(0.1,0.035,0.012)*uIronFraction;
    }else{
      vec3 rock=mercury?vec3(0.20,0.19,0.18):vec3(0.30,0.31,0.32);
      albedo=rock*(0.62+0.75*broad+0.18*fine)+vec3(0.12,0.085,0.055)*uIronFraction*medium;
      albedo+=vec3(0.13,0.12,0.105)*craterRim;
      albedo*=1.0-0.28*craterBasin;
    albedo+=vec3(0.08,0.035,0.012)*volcanic*0.35;
    }
    roughness=0.94;
    specular=0.018;
  }else if(uKind<3.5){
    float saturn=uColor.g>0.60?1.0:0.0;
    float warp=(fbm3(domainWarp3(n*vec3(5.0,18.0,5.0)+uSeed))-0.5)*0.095;
    float band=sin((n.y+warp)*(saturn>0.5?82.0:96.0)+medium*2.4);
    float storms=fbm3(n*vec3(18.0,7.0,18.0)+uSeed*4.0);
    vec3 base=saturn>0.5?vec3(0.48,0.34,0.19):vec3(0.40,0.20,0.105);
    vec3 lightBand=saturn>0.5?vec3(0.78,0.64,0.43):vec3(0.72,0.47,0.29);
    albedo=mix(base,lightBand,smoothstep(-0.18,0.55,band)*0.72);
    albedo=mix(albedo,albedo*vec3(0.66,0.78,0.92),smoothstep(0.68,0.88,storms)*0.24);
    albedo=mix(albedo,vec3(0.55,0.19,0.08),smoothstep(0.82,0.96,volcanic)*0.12);
    roughness=0.58;
    specular=0.045;
  }else if(uKind<4.5){
    if(uColor.g>uColor.b*0.85){
      float bands=sin((n.y+0.018*(broad-0.5))*72.0);
      albedo=mix(vec3(0.22,0.48,0.53),vec3(0.46,0.78,0.79),smoothstep(-0.2,0.55,bands)*0.38);
      albedo*=0.94+0.12*medium;
      roughness=0.72;
    }else{
      float storms=fbm3(domainWarp3(n*vec3(9.0,20.0,9.0)+uSeed))+ridged3(n*31.0+uSeed*4.0)*0.2;
      float bands=sin((n.y+0.025*(storms-0.5))*88.0);
      albedo=mix(vec3(0.045,0.11,0.32),vec3(0.12,0.31,0.66),smoothstep(-0.25,0.5,bands)*0.48);
      albedo=mix(albedo,vec3(0.78,0.43,0.22),smoothstep(0.78,0.91,storms)*0.42);
      roughness=0.7;
    }
    specular=0.035;
  }else if(uKind<5.5){
    if(uKind<5.2){
      float cloudBands=fbm3(domainWarp3(n*vec3(7.0,24.0,7.0)+vec3(uSeed,broad*3.0,medium*2.0)));
      float haze=fbm3(n*vec3(18.0,42.0,18.0)+uSeed*2.0);
      float bands=sin((n.y+0.025*(cloudBands-0.5))*46.0+medium*1.8);
      vec3 lowerCloud=mix(vec3(0.34,0.19,0.085),vec3(0.66,0.46,0.24),smoothstep(-0.45,0.55,bands));
      vec3 upperHaze=mix(vec3(0.72,0.55,0.34),vec3(0.94,0.82,0.62),haze);
      albedo=mix(lowerCloud,upperHaze,smoothstep(0.36,0.72,cloudBands)*0.78);
      albedo=mix(albedo,vec3(0.96,0.84,0.66),smoothstep(0.76,0.94,haze)*0.34);
      roughness=0.82;specular=0.018;
    }else if(uKind<5.35){
      float fractures=ridged3(domainWarp3(n*vec3(12.0,18.0,12.0)+uSeed*3.0));
      albedo=mix(vec3(0.58,0.72,0.82),vec3(0.86,0.93,0.97),smoothstep(0.28,0.82,fractures));
      roughness=0.3;specular=0.12;
    }else{
      float lavaField=fbm3(domainWarp3(n*vec3(13.0,19.0,13.0)+uSeed*4.0));
      float sulfurField=fbm3(n*31.0+uSeed*7.0);
      albedo=mix(vec3(0.045,0.025,0.018),vec3(0.72,0.54,0.12),smoothstep(0.32,0.78,sulfurField));
      albedo=mix(albedo,vec3(1.0,0.19,0.025),smoothstep(0.68,0.92,lavaField)*0.55);
      roughness=0.64;specular=0.025;
    }
  }
  vec3 bakedAlbedo=texture(uGeneratedAlbedo,n).rgb;
  float bakedHeight=texture(uGeneratedHeight,n).r;
  float bakedRoughness=texture(uGeneratedRoughness,n).r;
  float mapBlend=uUseGeneratedMaps;
  if(uPreviousMapsEnabled>0.5){bakedAlbedo=mix(texture(uPreviousAlbedo,n).rgb,bakedAlbedo,uUseGeneratedMaps);bakedHeight=mix(texture(uPreviousHeight,n).r,bakedHeight,uUseGeneratedMaps);bakedRoughness=mix(texture(uPreviousRoughness,n).r,bakedRoughness,uUseGeneratedMaps);mapBlend=1.0;}
  albedo=mix(albedo,bakedAlbedo,mapBlend);
  roughness=mix(roughness,bakedRoughness,mapBlend);
  albedo*=mix(1.0,0.9+0.2*bakedHeight,mapBlend);
  return max(albedo,vec3(0.0));
}
float distributionGGX(float ndoth,float roughness){
  float a=roughness*roughness;
  float a2=a*a;
  float d=ndoth*ndoth*(a2-1.0)+1.0;
  return a2/max(PI*d*d,0.0001);
}
float geometrySchlick(float ndotv,float roughness){
  float r=roughness+1.0;
  float k=(r*r)/8.0;
  return ndotv/max(ndotv*(1.0-k)+k,0.0001);
}
void main(){
  if(uKind>5.5&&uKind<6.5){
    gl_FragColor=vec4(pow(uColor,vec3(2.2))*2.8,1.0);
    return;
  }
  vec3 surfaceDirection=normalize(vSurfaceDirection);
  vec3 bakedNormal=texture(uGeneratedNormal,surfaceDirection).xyz*2.0-1.0;
  float normalBlend=uUseGeneratedMaps;
  if(uPreviousMapsEnabled>0.5){vec3 previousNormal=texture(uPreviousNormal,surfaceDirection).xyz*2.0-1.0;bakedNormal=normalize(mix(previousNormal,bakedNormal,uUseGeneratedMaps));normalBlend=1.0;}
  vec3 worldBakedNormal=normalize(mat3(uModel)*bakedNormal);
  vec3 n=normalize(mix(normalize(vNormal),worldBakedNormal,normalBlend*0.62));
  vec3 v=normalize(uCameraPosition-vPosition);
  float ndotv=max(dot(n,v),0.001);
  float roughness,specularLevel;
  vec3 albedo=surfaceAlbedo(surfaceDirection,roughness,specularLevel);
  vec3 f0=mix(vec3(0.018),vec3(0.075),specularLevel);
  vec3 directLight=vec3(0.0);
  for(int i=0;i<4;i++){
    if(i<uLightCount){
      vec3 toLight=uLightPositions[i]-vPosition;
      float distanceSquared=max(dot(toLight,toLight),1e-12);
      vec3 l=toLight*inversesqrt(distanceSquared);
      vec3 h=normalize(l+v);
      float ndotl=max(dot(n,l),0.0);
      if(ndotl>0.0){
        float visibility=i==0?shadowVisibility(vPosition):1.0;
        vec3 radiance=uLightColors[i]*(uLightIntensities[i]/(22.0*distanceSquared))*visibility;
        float ndoth=max(dot(n,h),0.0);
        float vdoth=max(dot(v,h),0.0);
        vec3 fresnel=f0+(1.0-f0)*pow(1.0-vdoth,5.0);
        float distribution=distributionGGX(ndoth,roughness);
        float geometry=geometrySchlick(ndotv,roughness)*geometrySchlick(max(ndotl,0.001),roughness);
        vec3 specular=distribution*geometry*fresnel/max(4.0*ndotv*max(ndotl,0.001),0.001);
        vec3 diffuse=albedo*(1.0-specularLevel*0.7)/PI;
        directLight+=(diffuse+specular)*radiance*ndotl;
      }
    }
  }
  // Only a very small indirect floor remains; a planet in deep shadow is not self-emissive.
  vec3 indirect=albedo*0.0001;
  gl_FragColor=vec4(max(directLight+indirect,vec3(0.0))*uBodyExposure,1.0);
}
`;
