export const PLANET_SURFACE_VERTEX = `attribute vec3 aPosition;
attribute vec3 aNormal;
uniform mat4 uViewProjection;
uniform mat4 uModel;
uniform float uKind;
uniform float uDetail;
uniform float uSeed;
varying vec3 vNormal;
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
void main(){
  vec3 n=normalize(aNormal);
  float terrain=fbm3(n*(18.0+uDetail*54.0)+uSeed);
  float relief=0.0;
  if(uKind>0.5&&uKind<1.5) relief=(terrain-0.48)*0.0018*uDetail;
  else if(uKind>1.5&&uKind<2.5) relief=(terrain-0.48)*0.009*uDetail;
  else if(uKind>2.5&&uKind<3.5) relief=(terrain-0.48)*0.00055*uDetail;
  else if(uKind>3.5&&uKind<5.5) relief=(terrain-0.48)*0.00025*uDetail;
  vec4 world=uModel*vec4(aPosition*(1.0+relief),1.0);
  vPosition=world.xyz;
  vNormal=normalize(mat3(uModel)*n);
  gl_Position=uViewProjection*world;
}`;

export const PLANET_SURFACE_FRAGMENT = `precision highp float;
uniform vec3 uColor;
uniform vec3 uCameraPosition;
uniform vec3 uLightPositions[4];
uniform vec3 uLightColors[4];
uniform float uLightIntensities[4];
uniform int uLightCount;
uniform float uKind;
uniform float uDetail;
uniform float uSeed;
uniform vec3 uSunPosition;
uniform float uSunRadius;
uniform vec3 uOccluders[8];
uniform float uOccluderRadii[8];
uniform int uOccluderCount;
uniform int uShadows;
varying vec3 vNormal;
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
  float broad=fbm3(n*3.1+uSeed);
  float medium=fbm3(n*(7.0+uDetail*6.0)+uSeed*2.7);
  float fine=fbm3(n*(8.0+uDetail*34.0)+uSeed*5.1);
  float latitude=abs(n.y);
  vec3 albedo=pow(uColor,vec3(2.2));
  roughness=0.82;
  specular=0.035;

  if(uKind<0.5){
    float granulation=fbm3(n*95.0+uSeed*7.0);
    float cells=sin((n.y*32.0+broad*4.0)*PI)*0.5+0.5;
    albedo=mix(vec3(0.30,0.075,0.018),vec3(1.0,0.53,0.16),0.55+0.35*cells+0.1*granulation);
    roughness=0.42;
    specular=0.0;
  }else if(uKind<1.5){
    float continentField=broad+(medium-0.5)*0.12;
    float land=smoothstep(0.455,0.555,continentField);
    float coast=1.0-smoothstep(0.0,0.035,abs(continentField-0.505));
    float desert=smoothstep(0.42,0.67,medium+latitude*0.12);
    vec3 ocean=mix(vec3(0.008,0.025,0.085),vec3(0.018,0.12,0.27),medium);
    vec3 vegetation=mix(vec3(0.045,0.105,0.035),vec3(0.16,0.25,0.075),fine);
    vec3 dryLand=mix(vec3(0.24,0.16,0.075),vec3(0.52,0.34,0.16),fine);
    vec3 landColor=mix(vegetation,dryLand,desert*0.72);
    landColor=mix(landColor,vec3(0.72,0.67,0.52),smoothstep(0.77,0.93,latitude));
    albedo=mix(ocean,landColor,land);
    albedo=mix(albedo,vec3(0.55,0.62,0.66),coast*0.22);
    float ice=smoothstep(0.86,0.96,latitude);
    albedo=mix(albedo,vec3(0.78,0.84,0.88),ice);
    roughness=mix(0.075,0.88,land);
    specular=mix(0.72,0.035,land);
  }else if(uKind<2.5){
    bool mars=uColor.r>0.6&&uColor.g<0.4;
    bool mercury=uColor.r<0.55&&uColor.g<0.55;
    float craterNoise=fbm3(n*(18.0+uDetail*40.0)+uSeed*3.0);
    float craterRim=smoothstep(0.48,0.55,craterNoise)-smoothstep(0.55,0.63,craterNoise);
    float craterBasin=1.0-smoothstep(0.34,0.53,craterNoise);
    if(mars){
      vec3 rust=mix(vec3(0.16,0.035,0.018),vec3(0.56,0.16,0.065),broad);
      rust=mix(rust,vec3(0.29,0.095,0.045),medium*0.55);
      albedo=rust*(0.82+0.28*fine);
      albedo+=vec3(0.09,0.035,0.015)*craterRim;
      albedo*=1.0-0.22*craterBasin;
      albedo=mix(albedo,vec3(0.72,0.68,0.61),smoothstep(0.91,0.97,latitude));
    }else{
      vec3 rock=mercury?vec3(0.20,0.19,0.18):vec3(0.30,0.31,0.32);
      albedo=rock*(0.62+0.75*broad+0.18*fine);
      albedo+=vec3(0.13,0.12,0.105)*craterRim;
      albedo*=1.0-0.28*craterBasin;
    }
    roughness=0.94;
    specular=0.018;
  }else if(uKind<3.5){
    float saturn=uColor.g>0.60?1.0:0.0;
    float warp=(fbm3(n*vec3(5.0,18.0,5.0)+uSeed)-0.5)*0.095;
    float band=sin((n.y+warp)*(saturn>0.5?82.0:96.0)+medium*2.4);
    float storms=fbm3(n*vec3(18.0,7.0,18.0)+uSeed*4.0);
    vec3 base=saturn>0.5?vec3(0.48,0.34,0.19):vec3(0.40,0.20,0.105);
    vec3 lightBand=saturn>0.5?vec3(0.78,0.64,0.43):vec3(0.72,0.47,0.29);
    albedo=mix(base,lightBand,smoothstep(-0.18,0.55,band)*0.72);
    albedo=mix(albedo,albedo*vec3(0.66,0.78,0.92),smoothstep(0.68,0.88,storms)*0.24);
    roughness=0.58;
    specular=0.045;
  }else if(uKind<4.5){
    if(uColor.g>uColor.b*0.85){
      float bands=sin((n.y+0.018*(broad-0.5))*72.0);
      albedo=mix(vec3(0.22,0.48,0.53),vec3(0.46,0.78,0.79),smoothstep(-0.2,0.55,bands)*0.38);
      albedo*=0.94+0.12*medium;
      roughness=0.72;
    }else{
      float storms=fbm3(n*vec3(9.0,20.0,9.0)+uSeed);
      float bands=sin((n.y+0.025*(storms-0.5))*88.0);
      albedo=mix(vec3(0.045,0.11,0.32),vec3(0.12,0.31,0.66),smoothstep(-0.25,0.5,bands)*0.48);
      albedo=mix(albedo,vec3(0.78,0.43,0.22),smoothstep(0.78,0.91,storms)*0.42);
      roughness=0.7;
    }
    specular=0.035;
  }else if(uKind<5.5){
    float cloudBands=fbm3(n*vec3(7.0,24.0,7.0)+vec3(uSeed,broad*3.0,medium*2.0));
    float haze=fbm3(n*vec3(18.0,42.0,18.0)+uSeed*2.0);
    float bands=sin((n.y+0.025*(cloudBands-0.5))*46.0+medium*1.8);
    vec3 lowerCloud=mix(vec3(0.34,0.19,0.085),vec3(0.66,0.46,0.24),smoothstep(-0.45,0.55,bands));
    vec3 upperHaze=mix(vec3(0.72,0.55,0.34),vec3(0.94,0.82,0.62),haze);
    albedo=mix(lowerCloud,upperHaze,smoothstep(0.36,0.72,cloudBands)*0.78);
    albedo=mix(albedo,vec3(0.96,0.84,0.66),smoothstep(0.76,0.94,haze)*0.34);
    roughness=0.82;
    specular=0.018;
  }
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
  vec3 n=normalize(vNormal);
  vec3 v=normalize(uCameraPosition-vPosition);
  float ndotv=max(dot(n,v),0.001);
  float roughness,specularLevel;
  vec3 albedo=surfaceAlbedo(n,roughness,specularLevel);
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
  gl_FragColor=vec4(max(directLight+indirect,vec3(0.0)),1.0);
}