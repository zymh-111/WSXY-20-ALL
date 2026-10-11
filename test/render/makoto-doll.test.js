// test/render/makoto-doll.test.js — 结城理 (char_4217_makoto, 自选干员) 的 <替身> 形态，客户端侧。
//
// 他的骨架里替身剪辑是**按技能分组**的（本体 Idle / Attack_A / Start / Stun / SwitchOut 之外）：
//   Doll_Skill_1_Attack / Idle / Die / Stun / SwitchIn / SwitchOut
//   Doll_Skill_2_Loop / Die / Stun / SwitchIn / SwitchOut
//   Doll_Skill_3_P1_Attack_A / Attack_B / Idle / Stun / SwitchIn / SwitchOut
//   Doll_Skill_3_P1toP2_ChangeBegin / ChangeEnd  +  Doll_Skill_3_P2_Loop / Die / Stun / SwitchOut
// 所以 render/units.js 的 FORMS.char_4217_makoto.doll 的 `roles` 是**技能索引的函数**
// （UnitView._formSpec 用 this.skillIndex 调用它）—— 这是本 fork 为自选干员加的唯一客户端改动。
//
// Headless 假 PIXI + 真清单；剪辑名与真骨架对照（素材在 public/assets/ 时）。

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';
import { spineEntry } from '../../public/js/assets.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const assets = JSON.parse(readFileSync(path.join(ROOT, 'data/assets.json'), 'utf8'));
const MAKOTO = 'char_4217_makoto';

let fake, UnitView, FORMS;
before(async () => {
  fake = installFakePixi();
  ({ UnitView, FORMS } = await import('../../public/js/render/units.js'));
});
after(() => fake.restore());

const tick = () => new Promise((r) => setImmediate(r));
const cam = () => presetCamera('normal', { width: 1280, height: 720 });
function store() {
  const s = {
    picture: () => null, image: async () => null, hasBack: () => false,
    spineEntry: (id, o) => spineEntry(assets, id, o),
    spine: { acquire: async (entry) => ({ animations: Object.keys(entry.animations || {}).map((name) => ({ name })) }), release() {} },
  };
  return s;
}
async function op(info = {}) {
  const ctx = fakeViewCtx(fake.P, { assets: store(), cam });
  const v = new UnitView(ctx, { id: 1, side: 'ally', kind: 'op', defId: MAKOTO, spine: MAKOTO, tier: 6, x: 5, y: 9, maxHp: 2805, dir: 'RIGHT', ...info });
  await tick(); await tick();
  assert.ok(v.actor, 'Spine model built');
  return v;
}
const clip = (v) => v.actor.current;

test('他在自选池里：清单有他的头像/立绘/技能图标与 spine 条目', () => {
  const c = assets.chars?.[MAKOTO];
  assert.ok(c, 'manifest 有他');
  assert.ok(c.avatar && c.avatarE2, '头像（含精英2）');
  assert.ok(c.portrait && c.portraitE2, '立绘（含精英2）');
  for (const s of ['skchr_makoto_1', 'skchr_makoto_2', 'skchr_makoto_3']) assert.ok(assets.skills?.[s], '技能图标 ' + s);
  assert.ok(c.spine?.front?.skel, 'spine 条目');
});

test('FORMS 里有他的 doll 形态，且 roles 是按技能索引的函数', () => {
  const spec = FORMS[MAKOTO]?.doll;
  assert.ok(spec, 'FORMS[char_4217_makoto].doll 存在');
  assert.equal(typeof spec.roles, 'function', 'roles 是函数（每个技能一套替身剪辑）');
  assert.equal(spec.leave, 'SwitchOut', '本体回归剪辑');
  const s1 = spec.roles(0), s2 = spec.roles(1), s3 = spec.roles(2);
  assert.equal(s1.idle, 'Doll_Skill_1_Idle'); assert.equal(s1.die, 'Doll_Skill_1_Die');
  assert.equal(s1.attack.loop, 'Doll_Skill_1_Attack');
  assert.equal(s2.idle, 'Doll_Skill_2_Loop'); assert.equal(s2.die, 'Doll_Skill_2_Die'); assert.equal(s2.attack, null);
  assert.equal(s3.idle, 'Doll_Skill_3_P1_Idle'); assert.equal(s3.die, 'Doll_Skill_3_P2_Die');
  // 三套互不相同（否则说明按技能选剪辑没生效）
  assert.notEqual(s1.idle, s2.idle); assert.notEqual(s2.idle, s3.idle);
});

test('_formSpec 按当前技能选替身剪辑：S1 / S2 / S3 各走自己那套', async () => {
  for (const [skillIndex, idle, die] of [[0, 'Doll_Skill_1_Idle', 'Doll_Skill_1_Die'],
    [1, 'Doll_Skill_2_Loop', 'Doll_Skill_2_Die'],
    [2, 'Doll_Skill_3_P1_Idle', 'Doll_Skill_3_P2_Die']]) {
    const v = await op({ skillIndex });
    assert.equal(v.form, null, '初始是本体');
    v.setForm('doll', { dur: 20 });
    const spec = v._formSpec();
    assert.ok(spec, `技能 ${skillIndex}: form 生效`);
    assert.equal(spec.roles.idle, idle, `技能 ${skillIndex} 的替身待机剪辑`);
    assert.equal(spec.roles.die, die, `技能 ${skillIndex} 的替身死亡剪辑`);
    v.update(1 / 60, cam(), 1 / 60);
    assert.ok(clip(v), '有剪辑在播');
    v.setForm(null);
  }
});

test('替身剪辑按**形态**选（不靠 skillIndex 猜）—— 修掉"先闪一帧俄耳甫斯"', () => {
  const spec = FORMS[MAKOTO].doll;
  const r = spec.roles;
  // 形态 key 由引擎随切换 fx 下发；拿到 key 时结果必须与技能索引无关地正确
  assert.equal(r({ doll: 'thanatos', skill: 2 }).idle, 'Doll_Skill_3_P1_Idle', '形态2（S3）= 塔纳托斯 P1');
  assert.equal(r({ doll: 'thanatos', skill: 1 }).idle, 'Doll_Skill_2_Loop', '形态2（S2）= 塔纳托斯 _2_');
  assert.equal(r({ doll: 'orpheus', skill: 2 }).idle, 'Doll_Skill_3_P2_Loop', '形态3（S3）= 俄耳甫斯 P2');
  assert.equal(r({ doll: 'orpheus', skill: 0 }).idle, 'Doll_Skill_1_Idle', 'S1 的替身 = 俄耳甫斯 _1_（会攻击）');
  assert.ok(spec.roles({ doll: 'orpheus', skill: 0 }).attack, 'S1 的替身有攻击剪辑');
  // 关键回归：没有形态 key 时才退回 skillIndex —— 早先 skillIndex 未就绪会退化成 S1 的俄耳甫斯
  assert.equal(r({ skill: 2 }).idle, 'Doll_Skill_3_P1_Idle', '拿不到形态时按 skillIndex 兜底');
  assert.equal(r(2).idle, 'Doll_Skill_3_P1_Idle', '直接传数字也认（兼容旧调用）');
});

test('切换进替身时先播 change 剪辑', async () => {
  const v = await op({ skillIndex: 0 });
  v.setForm('doll', { dur: 20 });
  v.update(1 / 60, cam(), 1 / 60);
  // 三个形态共用同一个面具部件（atlas 只有 B_PersonaOrps_*），差别只在剪辑，
  // 所以 change 统一用 P1 的 SwitchIn；形态本身由 roles 按 key 选。
  assert.equal(clip(v), 'Doll_Skill_3_P1_SwitchIn', '先播切换动画');
});

test('真骨架对照：上面引用的剪辑名都在他的骨架里（素材就位时才跑）', (t) => {
  const skel = path.join(ROOT, 'public/assets/spine/op', MAKOTO, 'front', MAKOTO + '.skel');
  if (!existsSync(skel)) { t.skip('素材未就位（public/assets/spine/op/char_4217_makoto/front/*.skel）'); return; }
  const names = new Set(Object.keys(assets.chars[MAKOTO].spine.front.animations ?? {}));
  const spec = FORMS[MAKOTO].doll;
  const used = new Set([spec.change, spec.leave]);
  for (const i of [0, 1, 2]) {
    const r = spec.roles(i);
    for (const k of ['idle', 'deploy', 'die', 'stun']) if (typeof r[k] === 'string') used.add(r[k]);
    if (r.attack?.loop) used.add(r.attack.loop);
  }
  const missing = [...used].filter((n) => n && !names.has(n));
  assert.deepEqual(missing, [], '引用的剪辑都在骨架里');
});
