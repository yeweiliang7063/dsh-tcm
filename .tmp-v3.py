import io
p='verify-preset.mjs'
s=io.open(p,encoding='utf-8').read()
old="chk('答题期间病人和裁判都不许插话'"
new="chk('开局只看「模拟问诊」开头、交卷只看两个字', (() => { const f = readFileSync('lib/sim-think.js', 'utf8'); return f.includes(\"const OPEN_MARK = /^\\s*【?\\s*模拟问诊/u\") && f.includes(\"return String(said || '').includes(HAND_IN)\") })());\nchk('答题期间病人和裁判都不许插话'"
assert old in s
s=s.replace(old,new,1)
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('ok')
