import io
p='verify-preset.mjs'
s=io.open(p,encoding='utf-8').read()
i=s.index("chk('开局只看「模拟问诊」开头、交卷只看两个字'")
j=s.index("\n", i)
new="chk('开局只看「模拟问诊」开头、交卷只看两个字', (() => { const f = fs.readFileSync('lib/sim-think.js', 'utf8'); return f.includes('const OPEN_MARK = /^') && f.includes('模拟问诊/u') && f.includes(\"return String(said || '').includes(HAND_IN)\") })());"
s=s[:i]+new+s[j:]
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('ok')
