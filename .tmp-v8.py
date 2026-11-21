import io
p='verify-preset.mjs'
s=io.open(p,encoding='utf-8').read()
if '答卷一旦开头就一直闭嘴' not in s:
    anchor="chk('答题期间病人和裁判都不许插话',"
    add='''chk('医生开始写答卷就一直闭嘴到交卷', (() => {
  const code = read('lib/sim-think.js')
  return code.includes('export function nextLatch') && code.includes('const answering = new Set()') && code.includes('answering.delete(sessionId)')
})())
'''
    i=s.index(anchor)+len(anchor)
    j=s.index('\n', s.index(')', i))
    s=s[:j+1]+add+s[j+1:]
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('ok')
