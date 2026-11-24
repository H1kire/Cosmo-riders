export type ShaderChunkName = string;

export interface ShaderProgramSource {
  vertex: string;
  fragment: string;
}

export class ShaderLibrary {
  private readonly chunks = new Map<ShaderChunkName,string>();

  register(name: ShaderChunkName, source: string): void {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error("Invalid shader chunk name: "+name);
    this.chunks.set(name,source);
  }

  has(name: ShaderChunkName): boolean { return this.chunks.has(name); }

  compose(source: string, defines: Record<string,string|number|boolean> = {}): string {
    const resolved=this.resolve(source,[]);
    const header=Object.entries(defines).map(([key,value])=>{
      if(!/^[A-Z_][A-Z0-9_]*$/.test(key))throw new Error("Invalid shader define: "+key);
      return "#define "+key+" "+(typeof value==="boolean"?(value?"1":"0"):value);
    }).join("\n");
    const version=resolved.match(/^#version[^\n]*\n/);
    if(!version)return header?header+"\n"+resolved:resolved;
    return version[0]+(header?header+"\n":"")+resolved.slice(version[0].length);
  }

  buildProgram(source: ShaderProgramSource, defines: Record<string,string|number|boolean> = {}): ShaderProgramSource {
    return {vertex:this.compose(source.vertex,defines),fragment:this.compose(source.fragment,defines)};
  }

  private resolve(source:string,stack:string[]):string {
    return source.replace(/#include\s+<([a-z][a-z0-9-]*)>/g,(_match,name:string)=>{
      if(stack.includes(name))throw new Error("Circular shader include: "+[...stack,name].join(" -> "));
      const chunk=this.chunks.get(name);
      if(chunk===undefined)throw new Error("Unknown shader chunk: "+name);
      return this.resolve(chunk,[...stack,name]);
    });
  }
}
