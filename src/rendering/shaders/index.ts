import { ShaderLibrary } from "../core/shader-library.ts";
import { SHADER_CHUNKS } from "./chunks.ts";

export function createDefaultShaderLibrary(): ShaderLibrary {
  const library=new ShaderLibrary();
  for(const [name,source] of Object.entries(SHADER_CHUNKS))library.register(name,source);
  return library;
}

export { SHADER_CHUNKS };
