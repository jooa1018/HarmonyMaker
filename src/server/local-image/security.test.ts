import { describe,it,expect } from "vitest";
import { authorizeLocalImage,assertLocalImageOrigin } from "./security";
const origin="http://127.0.0.1:3197",secret="isolated-fixture-secret",now=1800000000000;
const headers={host:"127.0.0.1:3197","x-hm-local-image":"1",origin};
const request=(extra:Record<string,string>={},method="GET")=>new Request(origin+"/api/local-image",{method,headers:{...headers,...extra}});
const session=()=>authorizeLocalImage(request(),origin,secret,true,now);
const cookie=(value:ReturnType<typeof session>)=>value.cookie!.split(";")[0];
describe("local image origin and session boundary",()=>{
  it("retains one signed owner across server reconstruction without exposing a script-readable cookie",()=>{
    const a=session(),restored=authorizeLocalImage(request({cookie:cookie(a)}),origin,secret,false,now+1000);
    expect(restored).toEqual({owner:a.owner,csrf:a.csrf});expect(a.cookie).toContain("HttpOnly; SameSite=Strict; Path=/api/local-image");expect(a.cookie).not.toContain("Domain=");
    expect(session().owner).not.toBe(a.owner);
  });
  it.each<Record<string,string>>([
    {origin:"https://example.com"},{origin:"null"},{origin:"http://localhost:3197"},{origin:"http://127.0.0.1:3196"},
    {host:"example.com"},{host:""},{host:"127.0.0.1:3196"},{"x-forwarded-host":"example.com"},{"x-hm-local-image":""},{"x-hm-local-image":"0"},
    {origin:"","sec-fetch-site":"cross-site"},{origin:"","sec-fetch-site":""}
  ])("rejects cross-origin or missing admission headers: %j",extra=>expect(()=>assertLocalImageOrigin(request(extra),origin)).toThrow("LOCAL_IMAGE_ORIGIN_REJECTED"));
  it("accepts a same-origin GET without Origin but requires explicit Origin for mutation",()=>{
    const a=session(),extra={cookie:cookie(a),origin:"","sec-fetch-site":"same-origin","x-hm-csrf":a.csrf};
    expect(authorizeLocalImage(request(extra),origin,secret,false,now).owner).toBe(a.owner);
    expect(()=>authorizeLocalImage(request(extra,"POST"),origin,secret,false,now)).toThrow("LOCAL_IMAGE_CSRF_REJECTED");
  });
  it("rejects absent, cross-session and non-ASCII CSRF with stable errors",()=>{
    const a=session(),b=session();
    for(const value of ["","wrong",b.csrf,"é".repeat(43)])expect(()=>authorizeLocalImage(request({cookie:cookie(a),"x-hm-csrf":value},"POST"),origin,secret,false,now)).toThrow("LOCAL_IMAGE_CSRF_REJECTED");
    expect(authorizeLocalImage(request({cookie:cookie(a),"x-hm-csrf":a.csrf},"POST"),origin,secret,false,now).owner).toBe(a.owner);
  });
  it("rejects missing, expired, swapped-key and malformed-MAC sessions without minting owners",()=>{
    const a=session(),raw=cookie(a),expiry=now+30*86400000;
    expect(()=>authorizeLocalImage(request(),origin,secret,false,now)).toThrow("LOCAL_IMAGE_SESSION_INVALID");
    expect(()=>authorizeLocalImage(request({cookie:raw}),origin,secret,false,expiry)).toThrow("LOCAL_IMAGE_SESSION_INVALID");
    expect(authorizeLocalImage(request({cookie:raw}),origin,secret,false,expiry-1).owner).toBe(a.owner);
    expect(()=>authorizeLocalImage(request({cookie:raw}),origin,"changed-key",false,now)).toThrow("LOCAL_IMAGE_SESSION_INVALID");
    expect(()=>authorizeLocalImage(request({cookie:raw.split(".").slice(0,2).join(".")+"."+"é".repeat(43)}),origin,secret,false,now)).toThrow("LOCAL_IMAGE_SESSION_INVALID");
  });
});
