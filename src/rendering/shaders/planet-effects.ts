export const ATMOSPHERE_VERTEX = `attribute vec3 aPosition;
attribute vec3 aNormal;
uniform mat4 uViewProjection;
uniform mat4 uModel;
varying vec3 vNormal;
varying vec3 vPosition;
void main(){
  vec4 world=uModel*vec4(aPosition,1.0);
  vPosition=world.xyz;
  vNormal=normalize(mat3(uModel)*aNormal);
  gl_Position=uViewProjection*world;
}`;

export const ATMOSPHERE_FRAGMENT = `#include <common>
#include <atmosphere>
uniform vec3 uLight;
uniform vec3 uLightColor;
uniform vec3 uCameraPosition;
uniform vec3 uPlanetCenter;
uniform vec3 uAtmosphereColor;
uniform float uMie;
uniform float uMieAnisotropy;
uniform float uIntensity;
uniform float uLightIntensity;
uniform float uShadowVisibility;
uniform float uGroundRadius;
uniform float uAtmosphereRadius;
uniform float uRayleighScaleHeight;
uniform float uMieScaleHeight;
uniform int uAtmosphereSamples;
varying vec3 vNormal;
varying vec3 vPosition;
float sphereNear(vec3 origin,vec3 direction,float radius){
  vec3 offset=origin-uPlanetCenter;
  float b=dot(offset,direction);
  float c=dot(offset,offset)-radius*radius;
  float discriminant=b*b-c;
  return discriminant>=0.0?-b-sqrt(discriminant):-1.0;
}
float sphereFar(vec3 origin,vec3 direction,float radius){
  vec3 offset=origin-uPlanetCenter;
  float b=dot(offset,direction);
  float c=dot(offset,offset)-radius*radius;
  float discriminant=b*b-c;
  return discriminant>=0.0?-b+sqrt(discriminant):-1.0;
}
void main(){
  vec3 n=safeNormalize(vNormal);
  vec3 viewRay=safeNormalize(vPosition-uCameraPosition);
  vec3 lightDir=safeNormalize(uLight);
  float outerNear=sphereNear(uCameraPosition,viewRay,uAtmosphereRadius);
  float outerFar=sphereFar(uCameraPosition,viewRay,uAtmosphereRadius);
  if(outerFar<=0.0)discard;
  float startDistance=max(0.0,outerNear);
  float groundNear=sphereNear(uCameraPosition,viewRay,uGroundRadius);
  float endDistance=groundNear>startDistance?min(outerFar,groundNear):outerFar;
  float pathLength=max(0.0,endDistance-startDistance);
  if(pathLength<=0.0)discard;
  float cosineAngle=dot(viewRay,lightDir);
  float phaseR=rayleighPhase(cosineAngle);
  float phaseM=miePhase(cosineAngle,uMieAnisotropy);
  float rayleighDepth=0.0;
  float mieDepth=0.0;
  int samples=clamp(uAtmosphereSamples,2,16);
  float stepLength=pathLength/float(samples);
  for(int i=0;i<16;i++){
    if(i<samples){
      float distanceAlong=startDistance+(float(i)+0.5)*stepLength;
      vec3 samplePosition=uCameraPosition+viewRay*distanceAlong;
      float altitude=max(0.0,length(samplePosition-uPlanetCenter)-uGroundRadius);
      rayleighDepth+=exp(-altitude/max(uRayleighScaleHeight,1e-8))*stepLength/max(uRayleighScaleHeight,1e-8);
      mieDepth+=exp(-altitude/max(uMieScaleHeight,1e-8))*stepLength/max(uMieScaleHeight,1e-8);
    }
  }
  float day=max(dot(n,lightDir),0.0);
  float rim=atmosphereRim(n,safeNormalize(uCameraPosition-vPosition),2.0);
  vec3 atmosphereColor=pow(uAtmosphereColor,vec3(2.2));
  float opticalAttenuation=exp(-rayleighDepth*0.055-mieDepth*0.11);
  vec3 rayleigh=atmosphereColor*rayleighDepth*phaseR*0.9;
  vec3 mie=vec3(1.0,0.82,0.62)*mieDepth*phaseM*uMie*0.42;
  vec3 scatter=(rayleigh+mie)*opticalAttenuation*(0.14+0.86*day*uShadowVisibility);
  scatter+=atmosphereColor*rim*0.055*(0.18+0.82*day*uShadowVisibility);
  float solarIrradiance=uLightIntensity/22.0;
  float alpha=clamp((1.0-opticalAttenuation)*0.24+rim*0.055,0.0,0.34)*uIntensity*solarIrradiance;
  gl_FragColor=vec4(scatter*uLightColor,alpha);
}`;

export const CLOUD_VERTEX = `attribute vec3 aPosition;
attribute vec3 aNormal;
uniform mat4 uViewProjection;
uniform mat4 uModel;
varying vec3 vNormal;
varying vec3 vPosition;
void main(){
  vec4 world=uModel*vec4(aPosition,1.0);
  vPosition=world.xyz;
  vNormal=normalize(mat3(uModel)*aNormal);
  gl_Position=uViewProjection*world;
}`;

export const CLOUD_FRAGMENT = `#include <common>
#include <noise>
uniform vec3 uLight;
uniform vec3 uLightColor;
uniform float uTime;
uniform vec2 uWind;
uniform float uCoverage;
uniform float uOpacity;
uniform float uScale;
uniform float uSeed;
uniform float uShadowVisibility;
uniform float uLightIntensity;
varying vec3 vNormal;
varying vec3 vPosition;
void main(){
  vec3 n=safeNormalize(vNormal);
  vec3 drift=vec3(uTime*uWind.x,0.0,uTime*uWind.y);
  vec3 p=n*uScale+drift+vec3(uSeed);
  float broad=fbm(p);
  float fine=fbm(p*2.65+13.7);
  float density=0.68*broad+0.32*fine;
  float edge=smoothstep(uCoverage,uCoverage+0.19,density);
  float holes=smoothstep(0.12,0.78,fine);
  float alpha=edge*holes*uOpacity;
  if(alpha<0.012)discard;
  float diffuse=max(dot(n,safeNormalize(uLight)),0.0);
  float lighting=0.01+0.99*diffuse*uShadowVisibility;
  vec3 cloudColor=vec3(0.88,0.93,1.0)*uLightColor*lighting*(uLightIntensity/22.0);
  gl_FragColor=vec4(cloudColor,alpha*0.62);
}`;
