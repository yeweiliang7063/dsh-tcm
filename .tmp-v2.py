import io
p='verify-preset.mjs'
s=io.open(p,encoding='utf-8').read()
old="chk('提示词也只认「交卷」两个字', presetPrefix.includes('只有医生明确说「交卷」') && presetPrefix.includes('等他说「交卷」'));"
new="chk('提示词也只认「交卷」两个字', presetPrefix.includes('只有医生明确说「交卷」') && presetPrefix.includes('③是「交卷」——才切裁判'));"
assert old in s
s=s.replace(old,new,1)
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('ok')
