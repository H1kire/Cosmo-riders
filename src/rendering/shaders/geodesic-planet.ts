export const GEODESIC_VERTEX_SHADER=`#version 300 es
precision highp float;precision highp sampler2DArray;
in vec3 aDirection;in vec2 aUv;
uniform mat4 uViewProjection;uniform mat4 uModel;
uniform sampler2DArray uHeight;uniform float uLayer;uniform float uRadiusM;uniform float uPageSize;uniform float uResolution;uniform float uGutter;
out vec2 vUv;out vec3 vWorldPosition;out vec3 vWorldDirection;
vec2 pageUv(vec2 uv){return (uv*uResolution+vec2(uGutter))/uPageSize;}
float sampleHeight(vec2 uv){
 vec2 pixel=pageUv(uv)*uPageSize-vec2(0.5),base=floor(pixel),fraction=fract(pixel);
 vec2 a=(base+vec2(0.5))/uPageSize,b=(base+vec2(1.5))/uPageSize;
 float h00=textureLod(uHeight,vec3(a,uLayer),0.0).r,h10=textureLod(uHeight,vec3(b.x,a.y,uLayer),0.0).r;
 float h01=textureLod(uHeight,vec3(a.x,b.y,uLayer),0.0).r,h11=textureLod(uHeight,vec3(b,uLayer),0.0).r;
 return mix(mix(h00,h10,fraction.x),mix(h01,h11,fraction.x),fraction.y);
}
void main(){
 vec3 direction=normalize(aDirection);
 float heightM=sampleHeight(aUv);
 vec3 local=direction*(1.0+heightM/uRadiusM);
 vec4 world=uModel*vec4(local,1.0);
 vUv=aUv;vWorldPosition=world.xyz;vWorldDirection=normalize(mat3(uModel)*direction);
 gl_Position=uViewProjection*world;
}`;
export const GEODESIC_FRAGMENT_SHADER=`#version 300 es
precision highp float;precision highp sampler2DArray;
in vec2 vUv;in vec3 vWorldPosition;in vec3 vWorldDirection;
uniform mat4 uModel;
uniform sampler2DArray uAlbedo;uniform sampler2DArray uNormal;uniform sampler2DArray uRoughness;uniform sampler2DArray uMaterial;
uniform float uLayer;uniform float uPageSize;uniform float uResolution;uniform float uGutter;uniform vec3 uCameraPosition;
uniform vec3 uLightPositions[4];uniform vec3 uLightColors[4];uniform float uLightIntensities[4];uniform int uLightCount;uniform float uBodyExposure;
uniform vec3 uSunPosition;uniform float uSunRadius;uniform vec3 uOccluders[8];uniform float uOccluderRadii[8];uniform int uOccluderCount;uniform int uShadows;
out vec4 outColor;
vec2 pageUv(vec2 uv){return (uv*uResolution+vec2(uGutter))/uPageSize;}
float shadowVisibility(vec3 point){
 if(uShadows==0)return 1.0;
 vec3 toSun=uSunPosition-point;float sunDistance=length(toSun);vec3 ray=toSun/max(sunDistance,1e-12);float visibility=1.0;
 for(int i=0;i<8;i++){if(i<uOccluderCount){vec3 delta=uOccluders[i]-point;float along=dot(delta,ray);if(along>0.0&&along<sunDistance){float perpendicular=length(delta-ray*along);float angularSun=uSunRadius*along/max(sunDistance-along,1e-12);float penumbra=uOccluderRadii[i]+angularSun;float umbra=max(0.0,uOccluderRadii[i]-angularSun);visibility*=smoothstep(umbra,max(umbra+1e-12,penumbra),perpendicular);}}}
 return clamp(visibility,0.0,1.0);
}
void main(){
 vec3 tc=vec3(pageUv(vUv),uLayer);
 vec3 albedo=texture(uAlbedo,tc).rgb;
 vec3 mapped=texture(uNormal,tc).rgb*2.0-1.0;
 float roughness=clamp(texture(uRoughness,tc).r,0.04,1.0);
 float material=texture(uMaterial,tc).r*255.0;
 if(material>2.5&&material<3.5)roughness=min(roughness,0.12);
 if(material>3.5&&material<4.5)roughness=max(roughness,0.3);
 vec3 n=normalize(mat3(uModel)*mapped);
 if(dot(n,vWorldDirection)<0.0)n=-n;
 vec3 view=normalize(uCameraPosition-vWorldPosition);vec3 color=albedo*0.0001;
 for(int i=0;i<4;i++){if(i<uLightCount){vec3 delta=uLightPositions[i]-vWorldPosition;float d2=max(dot(delta,delta),1e-12);vec3 light=delta*inversesqrt(d2);float ndl=max(dot(n,light),0.0);vec3 halfVector=normalize(light+view);float specular=pow(max(dot(n,halfVector),0.0),mix(96.0,4.0,roughness));float visibility=i==0?shadowVisibility(vWorldPosition):1.0;color+=(albedo/3.14159265+vec3(specular*(1.0-roughness)*0.12))*uLightColors[i]*(uLightIntensities[i]/(22.0*d2))*ndl*visibility;}}
 outColor=vec4(max(color,vec3(0.0))*uBodyExposure,1.0);
}`;
