import test from 'node:test'; import assert from 'node:assert/strict'
import { standing, specComponents, forAward, creditSummary, validMark, num, type CatalogueModule } from '../lib/modules'
import cat from '../data/programme.json'
const C = cat as unknown as CatalogueModule[]
test('standing: partial marks and needed average', () => {
  const s = standing([{ weight: 20, mark: 70 }, { weight: 80, mark: null }], 40)
  assert.equal(s.banked, 14); assert.equal(s.markedWeight, 20); assert.equal(s.averageSoFar, 70); assert.equal(s.remainingWeight, 80); assert.equal(s.neededAverage, 32.5); assert.equal(s.achievable, true); assert.equal(s.final, null)
})
test('standing: complete module gives final mark and pass/fail', () => {
  assert.deepEqual([standing([{ weight: 50, mark: 30 }, { weight: 50, mark: 40 }])].map(s => [s.final, s.passed]), [[35, false]])
  assert.equal(standing([{ weight: 50, mark: 60 }, { weight: 50, mark: 50 }]).passed, true)
})
test('standing: impossible target and unassigned weight', () => {
  const s = standing([{ weight: 50, mark: 10 }, { weight: 50, mark: null }], 70); assert.equal(s.neededAverage, 130); assert.equal(s.achievable, false)
  const u = standing([{ weight: 30, mark: 50 }]); assert.equal(u.unassigned, 70); assert.equal(u.remainingWeight, 70); assert.equal(u.final, null)
  assert.equal(standing([]).averageSoFar, null)
})
test('mark validation', () => { assert.ok(validMark(null) && validMark(0) && validMark(100)); assert.ok(!validMark(101) && !validMark(-1)); assert.equal(num(''), null); assert.equal(num('abc'), null); assert.equal(num('62.5'), 62.5) })
test('spec components follow the programme specification', () => {
  const m = C.find(x => x.code === '4COM2004')!; assert.deepEqual(specComponents(m), [{ title: 'Examination', weight: 50 }, { title: 'Coursework', weight: 50 }])
  for (const x of C.filter(x => !x.passfail)) assert.equal(specComponents(x).reduce((a, c) => a + c.weight, 0), 100, x.code)
})
test('catalogue: levels, awards, no duplicate codes', () => {
  assert.equal(new Set(C.map(x => x.code)).size, C.length)
  const l4 = forAward(C, 'CS', 4); assert.equal(l4.reduce((a, m) => a + m.credits, 0), 120)
  assert.ok(forAward(C, 'CS-AI', 6).some(m => m.code === '6COM2017')); assert.ok(!forAward(C, 'IT', 6).some(m => m.code === '6COM2018'))
  assert.ok(forAward(C, 'CS', 4, true).length > l4.length)
})
test('credit summary', () => { assert.deepEqual(creditSummary([{ level: 4, credits: 30, status: '', passed: true }, { level: 4, credits: 15, status: '', passed: null }]), { 4: { planned: 45, passed: 30 } }) })
