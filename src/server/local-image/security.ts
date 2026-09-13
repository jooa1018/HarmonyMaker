import { randomBytes, createHmac, createHash, timingSafeEqual } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const COOKIE = "hm_local_image";
const mac = (secret: string, value: string) => createHmac("sha256", secret).update(value).digest("base64url");
const same = (a: string, b: string) => /^[A-Za-z0-9_-]{43}$/u.test(a) && a.length === b.length && timingSafeEqual(Buffer.from(a),Buffer.from(b));
export interface LocalImageSession { readonly owner: string; readonly csrf: string; readonly cookie?: string }
export function assertLocalImageOrigin(request: Request, origin: string): void {
  const expected = new URL(origin).host;
  const source = request.headers.get("origin");
  if (request.headers.get("host") !== expected || request.headers.get("x-hm-local-image") !== "1"
    || (source ? source !== origin : request.headers.get("sec-fetch-site") !== "same-origin")
    || (request.headers.get("x-forwarded-host") && request.headers.get("x-forwarded-host") !== expected)) throw new Error("LOCAL_IMAGE_ORIGIN_REJECTED");
}
export async function localImageSecret(root: string): Promise<string> {
  await mkdir(root,{recursive:true});const file=path.join(root,"session-key.json");
  try { await writeFile(file,JSON.stringify({key:randomBytes(48).toString("base64url")}),{flag:"wx",mode:0o600}); }
  catch(error) {if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;}
  const value=JSON.parse(await readFile(file,"utf8")) as {key:string};
  if(!/^[A-Za-z0-9_-]{64}$/u.test(value.key))throw new Error("LOCAL_IMAGE_SESSION_KEY_INVALID");return value.key;
}
export function authorizeLocalImage(request: Request, origin: string, secret: string, issue = false, now = Date.now()): LocalImageSession {
  assertLocalImageOrigin(request,origin);
  let token=request.headers.get("cookie")?.split(";").map(s=>s.trim()).find(s=>s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length+1)??"";
  let parts=token.split(".");
  const valid=parts.length===3&&/^[A-Za-z0-9_-]{43}$/u.test(parts[0])&&/^\d{13}$/u.test(parts[1])&&Number(parts[1])>now&&same(parts[2],mac(secret,parts.slice(0,2).join(".")));
  let cookie: string|undefined;
  if(!valid){
    if(!issue)throw new Error("LOCAL_IMAGE_SESSION_INVALID");
    const payload=`${randomBytes(32).toString("base64url")}.${now+30*86400_000}`;token=`${payload}.${mac(secret,payload)}`;parts=token.split(".");
    cookie=`${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/api/local-image; Max-Age=2592000`;
  }
  const csrf=mac(secret,`csrf:${token}`);
  if(!["GET","HEAD"].includes(request.method)&&(request.headers.get("origin")!==origin||!same(request.headers.get("x-hm-csrf")??"",csrf)))throw new Error("LOCAL_IMAGE_CSRF_REJECTED");
  return {owner:createHash("sha256").update(parts[0]).digest("hex"),csrf,...(cookie?{cookie}:{})};
}
