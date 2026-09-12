/** Canonical object order without normalizing opaque XML/evidence strings. */
export function exactJson(value:unknown):string {
  return JSON.stringify(value,(_key,v)=>v&&typeof v==="object"&&!Array.isArray(v)
    ?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
}
/** Source's canonical text codec normalizes Unicode. Escaping the opaque proof
 * prevents it from changing original bytes inside nested XML/engine artifacts. */
export function asciiProofJson(value:unknown):string {
  return exactJson(value).replace(/[\u007f-\uffff]/g,c=>`\\u${c.charCodeAt(0).toString(16).padStart(4,"0")}`);
}
