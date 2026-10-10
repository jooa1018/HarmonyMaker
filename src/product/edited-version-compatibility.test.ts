import { readFileSync } from 'node:fs';
import { it,expect } from 'vitest';
import { prepareQuickHarmony,generateQuickHarmony } from './quick-harmony';
import { materializeEditedArrangement } from './edited-arrangement';
import { wagInputFromProject } from './workspace';
import { exportHarmonyProject, importHarmonyProject } from './project-transfer';
import {canonicalJson} from '../domain/digest/canonical';
import {loadFrozenWagAuthority} from '../grammar/authority';
it('WAG v1.1 edited snapshot must remain saveable',async()=>{
 const xml=readFileSync(new URL('./fixtures/wag11/4-4-1.musicxml',import.meta.url));
 const result=await generateQuickHarmony(await prepareQuickHarmony({bytes:new Uint8Array(xml),fileName:'original.musicxml'}),{parts:['tenor'],rightsConfirmed:true,confirmedAt:'2026-10-10T00:00:00.000Z'});
 if(result.status!=='complete')throw new Error(result.status);
 const project=result.project,v=project.variants.standard;
 if(v?.lifecycle!=='generation-attempted')throw new Error('missing generation');
 const materialized=await materializeEditedArrangement({lifecycleInput:await wagInputFromProject(project,'standard'),intentPlan:v.intentPlan,activityPlan:v.activityPlan,anchorPlan:v.anchorPlan,candidate:v.generationResult.candidates[0],edits:[]});
 if(materialized.status!=='complete')throw new Error(materialized.status);
 const next={...project,variants:{...project.variants,standard:{...v,editedSnapshots:[materialized.snapshot],activeArrangement:{kind:'edited-snapshot' as const,snapshotId:materialized.snapshot.id}}}};
 expect(materialized.snapshot.validatorVersion).toBe('validator-v2-wag1.1');
 const encoded=await exportHarmonyProject(next);
 expect(await exportHarmonyProject(await importHarmonyProject(encoded))).toBe(encoded);
 await expect(materializeEditedArrangement({lifecycleInput:await wagInputFromProject(project,'standard'),intentPlan:{...v.intentPlan,grammarVersion:'grammar-v99'},activityPlan:v.activityPlan,anchorPlan:v.anchorPlan,candidate:v.generationResult.candidates[0],edits:[]})).rejects.toThrow('WAG_VERSION_UNSUPPORTED');
 const unknown=JSON.parse(encoded);unknown.variants.standard.intentPlan.grammarVersion='grammar-v99';
 await expect(importHarmonyProject(JSON.stringify(unknown))).rejects.toThrow('PROJECT_INTEGRITY_INVALID');
});

it('legacy edit and save reproduce the independent pre-change bytes without a version upgrade',async()=>{
 const original=await importHarmonyProject(readFileSync(new URL('./fixtures/auto-draft-v1-alto.json',import.meta.url),'utf8'));
 const bytes=readFileSync(new URL('./fixtures/auto-draft-v1-edited.json',import.meta.url),'utf8');
 const saved=await importHarmonyProject(bytes);
 expect(await exportHarmonyProject(saved)).toBe(bytes);
 const v=original.variants.standard, savedVariant=saved.variants.standard;
 if(v?.lifecycle!=='generation-attempted'||savedVariant?.lifecycle!=='generation-attempted')throw new Error('missing generation');
 const edits=savedVariant.outputEdits;
 const candidate=v.generationResult.candidates.find(c=>c.id===edits[0].baseCandidateId)!;
 const result=await materializeEditedArrangement({lifecycleInput:await wagInputFromProject(original,'standard'),intentPlan:v.intentPlan,activityPlan:v.activityPlan,anchorPlan:v.anchorPlan,candidate,edits});
 if(result.status!=='complete')throw new Error(result.status);
 expect(result.snapshot.status).toBe('valid');
 expect(result.snapshot.validatorVersion).toBe('validator-v2-lasi-v0-r1');
 expect(canonicalJson(result.snapshot)).toBe(readFileSync(new URL('./fixtures/auto-draft-v1-edited-snapshot.json',import.meta.url),'utf8'));
 const edited={...original,variants:{...original.variants,standard:{...v,outputEdits:edits,editedSnapshots:[result.snapshot],activeArrangement:{kind:'edited-snapshot' as const,snapshotId:result.snapshot.id}}}};
 expect(await exportHarmonyProject(edited)).toBe(bytes);
 expect(edited.variants.standard.intentPlan.grammarVersion).toBe('grammar-v1.0.1');
});
it('authority lookup refuses every unknown version instead of falling back',async()=>{
 for(const version of ['grammar-v99','','grammar-v1.0','grammar-v1.1-preview'])await expect(loadFrozenWagAuthority(version)).rejects.toThrow('WAG_VERSION_UNSUPPORTED');
 expect((await loadFrozenWagAuthority('grammar-v1.0.1')).grammarConfig.grammarVersion).toBe('grammar-v1.0.1');
 expect((await loadFrozenWagAuthority('grammar-v1.1')).grammarConfig.grammarVersion).toBe('grammar-v1.1');
});
