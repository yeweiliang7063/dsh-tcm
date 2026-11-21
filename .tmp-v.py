import io
p='verify-preset.mjs'
s=io.open(p,encoding='utf-8').read()
old="chk('提示词也只认「交卷」两个字', presetPrefix.includes('只有医生明确说「交卷」') && presetPrefix.includes('等他说「交卷」'));"
new=old+"\nchk('答题期间病人和裁判都不许插话', presetPrefix.includes('【答题期间病人和裁判都不许插话】') && presetPrefix.includes('是在答题（陈述症状、讲病机、写治法方药、取穴、整段分析）') && presetPrefix.includes('病人不许自己开口，裁判不许提前点评'));"
assert old in s
s=s.replace(old,new,1)
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('ok')
