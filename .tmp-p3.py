import io
p='cordis.patch.yml'
s=io.open(p,encoding='utf-8').read()
old='                - 拿到病人名字后，医生每发一句话，你只看它属于哪一类，三选一，不许自己加戏：'
new='                - 拿到病人名字后，医生每发一句话，先看它有没有「问」的意思（带问号，或「吗／呢／是不是／要不要／有没有／怎么／多少」这类收尾，或「把舌头伸出来」「我摸一下脉」这种要病人配合的要求，或「请问」「问一下」开头）——有就按下面第①条办；没有（陈述、写病机、给治法方药穴位、整段分析）就按第②条办；出现「交卷」就按第③条办。三条只选一条，不许自己加戏：'
assert old in s
s=s.replace(old,new,1)
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('ok')
