# Apply the frozen HarmonyMaker WAG v1.0.1 contract

Copy these exact files into `jooa1018/HarmonyMaker` without changing bytes:

```text
docs/WORSHIP_ARRANGEMENT_GRAMMAR_v1.md
docs/WORSHIP_ARRANGEMENT_GRAMMAR_v1.freeze.json
src/grammar/worship-arrangement-grammar-v1.0.1.canonical.json
src/grammar/wag-v1-diagnostic-baseline.canonical.json
src/grammar/wag-v1-diagnostic-extension.canonical.json
README_APPLY.md
```

Normative identities:

```text
semantic version = 1.0.1
registry grammarVersion = grammar-v1.0.1
contract sha256 = ee09ded709273cc6468f1fd3f1df319d04458716f6ad911a878bffdb9b4498d5
config pretty-file sha256 = 676780f8ceacda6d88c5724156f84f95fb5b337b4d13d16342f5342cb617330d
config semantic digest = 5a71f18d5687c4884f8dad209c162f39b8152c1e3030fc4af4b429c7c41f4482
preset profile semantic digest = ae0fce2af71b10e7f387521b22fe737cb840f02881b95121761b2953154cd681
diagnostic baseline pretty-file sha256 = 0fa15cf0652e41b1509df0f8d140bfa165726a6799a83b19eed59b58dbbbab4c
diagnostic baseline semantic digest = 96e396a1fdb97a9cc9eba2b21a20c709cd5a96285126bfba1a406cba2f42ef70
diagnostic extension pretty-file sha256 = 4be25a0ae3cc28812b85da585e1ef6f0aa2f0ce5fc560e34177aa49eee06379b
diagnostic extension semantic digest = aee570a5fc6110107979c40708ebb0b48f645e23853a0e75084854c2cd6ce794
full diagnostic registry version = diagnostic-registry-v3-wag1-v0
full diagnostic registry digest = 0bdb9f5067cba55dad165d3679460a04f21e98b450a4624fa21eca1ffa3dcc77
```

The 94-code baseline definitions are a new frozen production authority closing a table that did not exist in v3.1.5 or the accepted code. They are not represented as recovered historical values.

`README_APPLY.md` is hash-pinned by the freeze manifest. To avoid a circular hash, this README does not embed the freeze-manifest SHA-256. Verify the manifest and ZIP with `HarmonyMaker_WAG_v1.0.1_SHA256SUMS.txt`.

Before implementation, verify accepted baseline commit `04bf71835daa712b077f245b4337a68e96f3d4ee`, every frozen identity, and a clean/non-conflicting working tree. PR #5 and PR #7 remain evidence only.
