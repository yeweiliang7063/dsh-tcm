/**
 * 按书名与正文样本判断一本书属于五类中的哪一类。
 *
 * 只做「够用」的关键词打分：书名权重高于正文，讲义/讲稿一类的强标记
 * 再额外加权。分数不够或明显拿不准时归「其他」，由调用方留在根目录，
 * 不硬塞进某一类——错移比不移更麻烦。
 */
const RULES = [
  {
    title: '医案',
    names: [
      '医案', '病案', '治验', '验案', '临证录', '医话', '经验集', '类案',
      '医案集', '临证', '实验录',
    ],
    contents: [
      '初诊', '复诊', '三诊', '四诊', '患者', '某男', '某女', '病例',
      '治验', '医案', '服药后', '按语',
    ],
    strong: ['初诊', '复诊', '患者', '某男', '某女', '病例'],
    nameWeight: 6,
    contentWeight: 2,
    strongWeight: 5,
  },
  {
    title: '经典注解',
    names: [
      '讲义', '讲稿', '讲记', '讲座', '文字版', '浅释', '白话', '今释',
      '校注', '注解', '注疏', '集注', '译注', '解读', '串讲', '浅注',
      '补正', '倪海厦', '倪海夏', '胡希恕', '刘渡舟', '郝万山', '成无己',
      '柯韵伯', '柯琴', '尤在泾', '尤怡', '张志聪', '张隐庵',
    ],
    contents: [
      '讲义', '讲稿', '讲记', '讲座', '这一条', '我们', '大家', '老师',
      '上课', '板书', '讲解', '条文', '意思是', '翻译', '按语',
    ],
    strong: ['讲义', '讲稿', '讲记', '讲座', '这一条', '老师', '上课', '板书'],
    nameWeight: 6,
    contentWeight: 2,
    strongWeight: 6,
  },
  {
    title: '名著',
    names: [
      '医书', '全书', '秘录', '外经', '大成', '血证', '血證', '医宗',
      '景岳', '脾胃论', '温病', '医论', '衷中参西', '儒门事亲', '丹溪',
      '东垣', '傅青主', '医林改错', '世补斋', '徐灵胎', '石室秘录',
      '陈士铎',
    ],
    contents: ['卷一', '卷二', '卷之', '卷第一', '序曰', '论曰', '全书', '秘录', '医论'],
    strong: ['卷一', '卷二', '卷之', '序曰'],
    nameWeight: 6,
    contentWeight: 1,
    strongWeight: 2,
  },
  {
    title: '方药',
    names: [
      '本草', '配方', '良方', '方书', '方论', '类方', '汤头', '药典',
      '药物', '方剂', '方解', '济世', '神农本草经', '证因方论',
      '倪师经典配方',
    ],
    contents: [
      '本草', '药性', '气味', '主治', '功效', '用量', '炮制', '配伍',
      '方剂', '汤头', '方解', '组成', '用法', '禁忌',
    ],
    strong: ['本草', '药性', '方解', '汤头', '方剂学'],
    nameWeight: 6,
    contentWeight: 2,
    strongWeight: 4,
  },
  {
    title: '经典',
    names: [
      '黄帝内经', '素问', '灵枢', '伤寒论', '金匮要略', '难经',
      '针灸甲乙经', '脉经', '濒湖脉学', '桂林古本', '伤寒杂病论',
    ],
    contents: [
      '太阳之为病', '阳明之为病', '少阳之为病', '太阴之为病',
      '少阴之为病', '厥阴之为病', '脉浮', '脉沉', '桂枝汤主之',
      '麻黄汤主之', '小柴胡汤主之', '伤寒论', '金匮要略', '素问',
      '灵枢', '难经',
    ],
    strong: [
      '太阳之为病', '阳明之为病', '少阳之为病', '太阴之为病',
      '少阴之为病', '厥阴之为病',
    ],
    nameWeight: 8,
    contentWeight: 2,
    strongWeight: 4,
  },
]

const ANNOTATION_MARKER = /讲义|讲稿|讲记|讲座|文字版|浅释|白话|今释|校注|注解|注疏|集注|译注|解读|串讲|浅注|补正|倪海厦|倪海夏|胡希恕|刘渡舟|郝万山|成无己|柯韵伯|柯琴|尤在泾|尤怡|张志聪|张隐庵/

const CASE_MARKER = /医案|病案|治验|验案|临证录|医话|经验集|类案/

const CLASSIC_ORIGINAL = /太阳之为病|阳明之为病|少阳之为病|太阴之为病|少阴之为病|厥阴之为病/

function scoreRule(rule, name, text) {
  let score = 0
  const seen = new Set()
  const add = (keyword, weight) => {
    if (!keyword || seen.has(keyword)) return
    if (name.includes(keyword) || text.includes(keyword)) {
      score += weight
      seen.add(keyword)
    }
  }
  for (const keyword of rule.names) add(keyword, rule.nameWeight)
  for (const keyword of rule.contents) add(keyword, rule.contentWeight)
  // 强标记单独加分，不和正文关键词共用去重：像「这一条」「老师」既是
  // 正文词也是讲稿的强信号，应该同时拿到两档权重。
  for (const keyword of rule.strong) {
    if (keyword && (name.includes(keyword) || text.includes(keyword))) score += rule.strongWeight
  }
  return score
}

/**
 * @param {{name?: string, text?: string}} book
 * @returns {{category: string, score: number}}
 */
export function classifyBook({ name = '', text = '' } = {}) {
  const n = String(name || '').toLowerCase()
  const t = String(text || '').toLowerCase()
  const scores = new Map()
  for (const rule of RULES) scores.set(rule.title, scoreRule(rule, n, t))

  const annotation = ANNOTATION_MARKER.test(n) || ANNOTATION_MARKER.test(t)
  const nameAnnotation = ANNOTATION_MARKER.test(n)
  const classicOriginal = CLASSIC_ORIGINAL.test(t)

  // 讲经典的书（讲义、讲稿、讲记）优先归「经典注解」，不跟原文混在一起。
  if (annotation && (scores.get('经典') || 0) > 0) {
    scores.set('经典注解', (scores.get('经典注解') || 0) + 8)
  }

  // 书名本身带作者名或「讲义」标记、又落在方药或名著上时（如倪海厦讲
  // 《神农本草经》），本质仍是讲稿，归「经典注解」；但书名带医案/病案时
  // 仍按医案走。只用书名判断，避免正文里一个「按语」把方书误抬成讲稿。
  if (nameAnnotation && !CASE_MARKER.test(n)) {
    const lectureTop = Math.max(
      scores.get('经典') || 0,
      scores.get('名著') || 0,
      scores.get('方药') || 0,
    )
    if (lectureTop > 0) {
      scores.set('经典注解', Math.max(scores.get('经典注解') || 0, lectureTop + 1))
    }
  }

  // 《金匮要略方论》是原文，不是方书；没有讲义标记时强行归经典。
  if (n.includes('金匮要略方论') && !annotation) {
    scores.set('经典', Math.max(scores.get('经典') || 0, 12))
    scores.set('方药', 0)
  }

  // 《伤寒论类方》《伤寒论方论》一类是方书，不是原文。
  if (/类方|方论|方解/.test(n) && !n.includes('金匮要略方论') && !annotation) {
    scores.set('方药', (scores.get('方药') || 0) + 4)
  }

  // 没有讲义标记、正文又是典型原文（太阳之为病……）时，给经典加权。
  if (classicOriginal && !annotation) {
    scores.set('经典', (scores.get('经典') || 0) + 4)
  }

  let best = { category: '其他', score: 0 }
  for (const rule of RULES) {
    const score = scores.get(rule.title) || 0
    if (score > best.score) best = { category: rule.title, score }
  }
  if (best.score < 5) return { category: '其他', score: best.score }
  return best
}
