import io
p='CHANGELOG.md'
s=io.open(p,encoding='utf-8').read()
anchor='- 闭嘴规则清成一条'
add='''- 闭嘴改成「答卷锁存」：医生一开始写答卷（这一句没有提问的意思）就闭嘴，**一直到他说「交卷」**为止，中间再补一句问话也不放出半句——答卷是连贯的一整段，中间冒出半句就把后面怎么答剧透了。另有两条不算答卷、照常开口：开局指令、交卷本身；交完卷再问，问句照常转病人。
- 顺手修一处真机故障：宿主每一轮都会往会话里塞自己生成的 `user/message`（预设指令、运行时上下文、子智能体回话、重试），原来被当成医生打的字去判「有没有提问」——医生明明问了、答案却被清空。现在这些来源一律跳过（`INJECTED_SOURCE`），子智能体回来叫醒的那一轮仍然闭嘴（`NOTICE_SOURCE`）。
'''
i=s.index(anchor)
s=s[:i]+add+s[i:]
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('ok')
