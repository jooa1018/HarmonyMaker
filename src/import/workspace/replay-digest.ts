import { canonicalJson } from "../../domain/digest/canonical";
import { clean } from "./edit";
import { SCORE_WORKSPACE_VERSION, type WorkspaceState } from "./model";

/** Only for privately owned, immutable reducer states in one verified lineage.
 * Keeps the exact v1 canonical bytes; no snapshot or external cached digest is
 * trusted. Weak keys release replaced states; immutable workspace ownership may
 * retain the encoder across edits. Never use caller-owned mutable states. */
export function createReplayStateDigester() {
  const utf8 = new TextEncoder();
  const encoded = new WeakMap<object, Uint8Array>();
  const field = (value: unknown): Uint8Array => {
    if (value === null || typeof value !== "object") return utf8.encode(canonicalJson(value));
    const hit = encoded.get(value);
    if (hit !== undefined) return hit;
    const result = utf8.encode(canonicalJson(clean(value)));
    encoded.set(value, result);
    return result;
  };
  const prefix=utf8.encode(`{"schema":${canonicalJson(SCORE_WORKSPACE_VERSION)},"state":{`);
  const end=utf8.encode("}}"),openArray=utf8.encode("["),closeArray=utf8.encode("]"),comma=utf8.encode(",");
  const keys=new Map<string,Uint8Array>();
  return async (state: WorkspaceState): Promise<string> => {
    const fields = Object.entries(state).filter(([, value]) => value !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    // Keep canonical UTF-8 segments as well as their immutable ownership. A
    // long replay must still hash every complete state, but need not flatten
    // and UTF-8 encode the same music and old judgments at every operation.
    const segments:Uint8Array[]=[prefix];
    for(const [index,[key,value]] of fields.entries()) {
      if(index)segments.push(comma);
      let encodedKey=keys.get(key);if(!encodedKey){encodedKey=utf8.encode(`${canonicalJson(key)}:`);keys.set(key,encodedKey);}
      segments.push(encodedKey);
      if(key==='attestations') {
        segments.push(openArray);
        state.attestations.forEach((a,i)=>{if(i)segments.push(comma);segments.push(field(a));});
        segments.push(closeArray);
      }else segments.push(field(value));
    }
    segments.push(end);
    const bytes=new Uint8Array(segments.reduce((sum,segment)=>sum+segment.byteLength,0));
    let offset=0;for(const segment of segments){bytes.set(segment,offset);offset+=segment.byteLength;}
    // This freshly assembled buffer never escapes. The general binaryDigest
    // copies caller-owned input; duplicating this private buffer at every
    // historical state needlessly doubles its temporary allocation.
    const digest=await globalThis.crypto.subtle.digest("SHA-256",bytes.buffer);
    return Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,"0")).join("");
  };
}
