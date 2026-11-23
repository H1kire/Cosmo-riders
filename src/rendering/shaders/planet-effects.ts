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
uniform vec3 uAtmosphereColor;
uniform float uMie;
uniform float uIntensity;
uniform float uShadowVisibility;
varying vec3 vNormal;
varying vec3 vPosition;
void main(){
  vec3 n=safeNormalize(vNormal);
  vec3 viewDir=safeNormalize(uCameraPosition-vPosition);
  vec3 lightDir=safeNormalize(uLight);
  float day=max(dot(n,lightDir),0.0);
  float rim=atmosphereRim(n,viewDir,2.15);
  float cosineAngle=dot(viewDir,lightDir);
  float phase=rayleighPhase(cosineAngle)*5.0+miePhase(cosineAngle,0.76)*uMie*0.8;
  float horizon=pow(1.0-abs(dot(n,viewDir)),1.35);
  float lit=0.16+0.84*day*uShadowVisibility;
  vec3 atmosphereColor=pow(uAtmosphereColor,vec3(2.2));
  vec3 scatter=atmosphereColor*(0.28+phase*2.1+horizon*0.18)*lit;
  float alpha=clamp((rim*0.58+horizon*0.10)*uIntensity,0.0,0.68);
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
uniform float uCoverage;
uniform float uOpacity;
uniform float uScale;
uniform float uSeed;
uniform float uShadowVisibility;
varying vec3 vNormal;
varying vec3 vPosition;
void main(){
  vec3 n=safeNormalize(vNormal);
  vec3 drift=vec3(uTime*0.0018,0.0,uTime*0.0011);
  vec3 p=n*uScale+drift+vec3(uSeed);
  float broad=fbm(p);
  float fine=fbm(p*2.65+13.7);
  float density=0.68*broad+0.32*fine;
  float edge=smoothstep(uCoverage,uCoverage+0.19,density);
  float holes=smoothstep(0.12,0.78,fine);
  float alpha=edge*holes*uOpacity;
  if(alpha<0.012)discard;
  float diffuse=max(dot(n,safeNormalize(uLight)),0.0);
  float lighting=0.24+0.76*diffuse*uShadowVisibility;
  vec3 cloudColor=vec3(0.88,0.93,1.0)*uLightColor*lighting;
  gl_FragColor=vec4(cloudColor,alpha*0.88);
}`;
