import io
p='lib/sim-think.js'
s=io.open(p,encoding='utf-8').read()
old="      const ask = looksQuestion(said) || wantsHandIn(said)"
new="      // 开局那句本身不是问句，但这一轮必须让模型开口（派病人、报第一句），不能闭嘴。\n      const opening = OPEN_MARK.test(said) || said.startsWith(OPEN_PREFIX)\n      const ask = opening || looksQuestion(said) || wantsHandIn(said)"
assert old in s
s=s.replace(old,new,1)
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('ok')
