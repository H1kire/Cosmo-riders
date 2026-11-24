export const SHADER_CHUNKS = {
  common: `
precision highp float;
const float PI = 3.141592653589793;
float saturate(float x) { return clamp(x,0.0,1.0); }
vec3 safeNormalize(vec3 v) { return v * inversesqrt(max(dot(v,v),1e-12)); }
`,
  noise: `
float hash31(vec3 p) {
  p=fract(p*0.1031); p+=dot(p,p.yxz+33.33);
  return fract((p.x+p.y)*p.z);
}
float valueNoise(vec3 p) {
  vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash31(i),hash31(i+vec3(1,0,0)),f.x),
                 mix(hash31(i+vec3(0,1,0)),hash31(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash31(i+vec3(0,0,1)),hash31(i+vec3(1,0,1)),f.x),
                 mix(hash31(i+vec3(0,1,1)),hash31(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float fbm(vec3 p) {
  float value=0.0, amplitude=0.5;
  for(int i=0;i<5;i++){ value+=valueNoise(p)*amplitude; p*=2.03; amplitude*=0.5; }
  return value;
}
`,
  lighting: `
float lambertDiffuse(vec3 normal,vec3 lightDirection) {
  return max(dot(safeNormalize(normal),safeNormalize(lightDirection)),0.0);
}
vec3 applyDirectLight(vec3 albedo,vec3 normal,vec3 lightDirection,vec3 lightColor,float visibility) {
  return albedo*lightColor*lambertDiffuse(normal,lightDirection)*saturate(visibility);
}
`,
  atmosphere: `
float rayleighPhase(float cosineAngle) {
  return 3.0/(16.0*PI)*(1.0+cosineAngle*cosineAngle);
}
float miePhase(float cosineAngle,float anisotropy) {
  float g=clamp(anisotropy,-0.95,0.95),g2=g*g;
  float d=max(1e-4,1.0+g2-2.0*g*cosineAngle);
  return 3.0/(8.0*PI)*(1.0-g2)*(1.0+cosineAngle*cosineAngle)/((2.0+g2)*pow(d,1.5));
}
vec3 approximateAtmosphere(vec3 rayleighColor,float mieAmount,float cosineAngle,float opticalDepth) {
  float depth=max(opticalDepth,0.0);
  float transmittance=exp(-depth);
  float scatter=1.0-transmittance;
  float phase=rayleighPhase(cosineAngle)+mieAmount*miePhase(cosineAngle,0.76);
  return rayleighColor*scatter*phase;
}
float atmosphereRim(vec3 normal,vec3 viewDirection,float power) {
  return pow(1.0-saturate(dot(safeNormalize(normal),safeNormalize(viewDirection))),max(0.1,power));
}
`,
  clouds: `
float cloudDensity(vec3 direction,float scale,float coverage,float timeSeconds) {
  vec3 p=safeNormalize(direction)*max(0.01,scale)+vec3(timeSeconds*0.002,0.0,timeSeconds*0.0013);
  float detail=0.72*fbm(p)+0.28*fbm(p*2.7+17.0);
  return smoothstep(coverage,coverage+0.16,detail);
}
vec4 shadeCloudLayer(vec3 direction,float scale,float coverage,float opacity,float timeSeconds) {
  float density=cloudDensity(direction,scale,coverage,timeSeconds)*saturate(opacity);
  return vec4(vec3(0.88,0.93,1.0),density);
}
`,
  eclipse: `
float circleOverlapFraction(float sourceRadius,float blockerRadius,float separation) {
  float r=max(sourceRadius,0.0),q=max(blockerRadius,0.0),d=max(separation,0.0);
  if(r<=0.0||q<=0.0||d>=r+q)return 0.0;
  if(d<=abs(r-q))return min(1.0,(min(r,q)*min(r,q))/(r*r));
  float x=clamp((d*d+r*r-q*q)/(2.0*d*r),-1.0,1.0);
  float y=clamp((d*d+q*q-r*r)/(2.0*d*q),-1.0,1.0);
  float area=r*r*acos(x)+q*q*acos(y)-0.5*sqrt(max(0.0,(-d+r+q)*(d+r-q)*(d-r+q)*(d+r+q)));
  return clamp(area/(PI*r*r),0.0,1.0);
}
`,
  postprocess: `
vec3 toneMapReinhard(vec3 color) { return color/(vec3(1.0)+color); }
vec3 toneMapACES(vec3 color) {
  const float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14;
  return clamp((color*(a*color+b))/(color*(c*color+d)+e),0.0,1.0);
}
`
} as const;
