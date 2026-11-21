import io
p='verify-preset.mjs'
s=io.open(p,encoding='utf-8').read()
s=s.replace("  const code = read('lib/sim-think.js')","  const code = fs.readFileSync(path.join(PLUGIN, 'lib', 'sim-think.js'), 'utf8')")
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('ok')
