import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it } from "vitest";
import { QUICK_HARMONY_NOTICE_CATALOG, quickHarmonyNotice } from "./quick-harmony-notices";
import { prepareQuickHarmony } from "./quick-harmony";

function source(path: string) {
  return ts.createSourceFile(path,readFileSync(new URL(path,import.meta.url),"utf8"),ts.ScriptTarget.Latest,true);
}
function visit(node: ts.Node, callback: (node: ts.Node)=>void) {
  callback(node);
  ts.forEachChild(node,child=>visit(child,callback));
}

it("covers every emitted finding code, including the structural blocker code families",()=>{
  const assessment = source("../import/workspace/auto-draft.ts");
  const codes = new Set<string>();
  // Discover the actual producers, so adding a new code fails until copy exists.
  for (const name of ["effectiveRequest","classifyIssue","computeAutoDraft"]) {
    const fn=assessment.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);
    expect(fn, name).toBeDefined();
    visit(fn!,node=>{
      if(ts.isPropertyAssignment(node)&&node.name.getText(assessment)==="code") {
        expect(ts.isStringLiteral(node.initializer),node.getText(assessment)).toBe(true);
        if(ts.isStringLiteral(node.initializer))codes.add(node.initializer.text);
      }
    });
  }
  const classifier=assessment.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==="classifyBlocker");
  expect(classifier).toBeDefined();
  const unsupported:string[]=[];
  const templates:string[]=[];
  visit(classifier!,node=>{
    if(ts.isArrayLiteralExpression(node)&&ts.isPropertyAccessExpression(node.parent)&&node.parent.name.text==="includes")for(const item of node.elements){
      expect(ts.isStringLiteral(item)).toBe(true);
      if(ts.isStringLiteral(item))unsupported.push(item.text);
    }
    if(ts.isPropertyAssignment(node)&&node.name.getText(assessment)==="code")templates.push(node.initializer.getText(assessment));
  });
  expect(templates).toEqual(['`UNSUPPORTED_${kind.toUpperCase().replace(/-/gu, "_")}`','`STRUCTURE_${kind.toUpperCase().replace(/-/gu, "_")}`']);
  expect(unsupported.length).toBeGreaterThan(0);
  const review=source("../import/workspace/review.ts");
  const evaluation=review.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==="evaluateArrangement");
  expect(evaluation).toBeDefined();
  visit(evaluation!,node=>{
    if(!ts.isCallExpression(node)||node.expression.getText(review)!=="add")return;
    const id=node.arguments[0];
    // Review-only raw issues never enter the structural auto-draft path.
    if(id.getText(review)==="issue.id")return;
    expect(ts.isStringLiteral(id)||ts.isTemplateExpression(id),id.getText(review)).toBe(true);
    const head=ts.isStringLiteral(id)?id.text:ts.isTemplateExpression(id)?id.head.text:"";
    const kind=head.split(":")[0];
    codes.add(`${unsupported.includes(kind)?"UNSUPPORTED":"STRUCTURE"}_${kind.toUpperCase().replace(/-/gu,"_")}`);
  });
  expect(codes.size).toBeGreaterThan(35);
  for(const code of codes){
    expect(Object.hasOwn(QUICK_HARMONY_NOTICE_CATALOG,code),code).toBe(true);
    expect(QUICK_HARMONY_NOTICE_CATALOG[code].messageKo,code).toMatch(/[가-힣]/u);
    expect(QUICK_HARMONY_NOTICE_CATALOG[code].actionKo,code).toMatch(/[가-힣]/u);
  }
});

it("keeps supported answer values and owns its returned choice objects",()=>{
  const finding={id:"chord",code:"PRINTED_CHORD_UNREAD",category:"question"} as const;
  const notice=quickHarmonyNotice(finding,"12번째 마디");
  expect(notice.messageKo).toMatch(/^12번째 마디: /u);
  expect(notice.choices.map(choice=>choice.value)).toEqual(["carry-previous","edit-in-workspace"]);
  Object.assign(notice.choices[0],{labelKo:"tampered"});
  expect(quickHarmonyNotice(finding).choices[0].labelKo).not.toBe("tampered");
});

it.each(["question","warning","unsupported"] as const)("gives unknown %s codes a safe Korean fallback without raw diagnostics",category=>{
  for(const code of ["FUTURE_CODE","toString","__proto__"]){
    const notice=quickHarmonyNotice({id:"unknown",code,category},"악보 전체");
    expect(notice.messageKo).toMatch(/^악보 전체: /u);
    expect(notice.actionKo).toContain("확인");
    expect(notice.choices.length).toBe(category==="question"?1:0);
    expect(JSON.stringify(notice)).not.toContain(code);
  }
});

const original=readFileSync(new URL("./fixtures/wag11/4-4-1.musicxml",import.meta.url),"utf8");
it.each([
  ["UNSUPPORTED_METER","unsupported",original.replace("<beats>4</beats>","<beats>5</beats>")],
  ["STRUCTURE_OVERFULL","needs-input",original.replace("</note>","</note>"+original.match(/<note>[\s\S]*?<\/note>/u)![0])],
  ["FERMATA_AS_WRITTEN","ready",original.replace("</note>","<notations><fermata/></notations></note>")],
] as const)("locates %s in the printed score while preserving raw details",async(code,status,xml)=>{
  const prep=await prepareQuickHarmony({bytes:new TextEncoder().encode(xml),fileName:"notice.musicxml"});
  expect(prep.status).toBe(status);
  const raw=prep.details.assessment!.findings.find(f=>f.code===code)!;
  expect(raw).toBeDefined();
  const notice=[...prep.questions,...prep.reasons,...prep.notes].find(n=>n.id===raw.id)!;
  expect(notice.messageKo).toMatch(/^1번째 마디: /u);
  expect(notice.messageKo).not.toBe(raw.messageKo);
  expect(notice.actionKo).not.toBe(raw.effectKo);
  expect(notice.messageKo+notice.actionKo).not.toMatch(/Lead|WAG|이벤트|hard|provenance/u);
  expect(await prepareQuickHarmony({bytes:new TextEncoder().encode(xml),fileName:"notice.musicxml"})).toEqual(prep);
});
