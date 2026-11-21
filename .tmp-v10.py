import io
p='verify-preset.mjs'
s=io.open(p,encoding='utf-8').read()
old="""chk('医生开始写答卷就一直闭嘴到交卷', (() => {
  const code = fs.readFileSync(path.join(PLUGIN, 'lib', 'sim-think.js'), 'utf8')
  return code.includes('export function nextLatch') && code.includes('const answering = new Set()') && code.includes('answering.delete(sessionId)')
})())"""
new="""chk('闭嘴只认「答卷」两个字', (() => {
  const code = fs.readFileSync(path.join(PLUGIN, 'lib', 'sim-think.js'), 'utf8')
  return code.includes("String(said).includes('答卷')") && code.includes('quietly.add(sessionId)')
    && !code.includes('looksQuestion') && !code.includes('INJECTED_SOURCE') && !code.includes('nextLatch')
})())"""
assert old in s
s=s.replace(old,new,1)
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('ok')
