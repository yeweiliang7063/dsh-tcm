import io
p='CHANGELOG.md'
s=io.open(p,encoding='utf-8').read()
anchor='- 「出重复的病」这件事补上跨重启的那一半'
add='- 医生答题的时候，病人和裁判都不许插话：转话规则改成三选一——问句（或「把舌头伸出来」「我摸一下脉」这类要病人配合的要求）才转给病人；医生在写答卷（陈述、病机、治法方药、取穴、整段分析）时，什么都不做，不转话、不点评、不写旁白，直接结束这一轮；只有「交卷」才切裁判。\n'
i=s.index(anchor)
s=s[:i]+add+s[i:]
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('ok')
