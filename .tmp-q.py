import io
p='lib/sim-think.js'
s=io.open(p,encoding='utf-8').read()
old='''      const fromDoctor = (() => {
        const kind = event.data?.source?.kind
        return kind === undefined || kind === 'user' || kind === 'retry'
      })()'''
new='''      // 只有「子智能体结束」这一类通知才算不是医生在说话；其余（医生本人敲的、
      // 诊室面板代发的开局与交卷、带自定义 source 的）一律当医生本人。
      const fromDoctor = (event.data?.source?.kind !== 'subagent-settled')'''
assert old in s
s=s.replace(old,new,1)
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('ok')
