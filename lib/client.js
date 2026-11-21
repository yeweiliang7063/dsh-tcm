/**
 * 学理模式 · 浏览器半（手写 ModuleLoader bundle，无构建步骤）
 *
 * 一个座位：设置页左侧导航里的「中医 · 经方（学习版）」一节。
 * 里面只有一项设置：资料库目录。
 * 改完保存，下一句话就按新目录找书，不用重启。
 */
window.__ModuleLoader__.load({
  // 登记名必须等于 package.json 的 name（dsh-tcm-xueli）。宿主按包名把浏览器半侧挂进模块表，
  // 写成目录名 dsh-tcm-xueli 时这份半侧永远等不到导入，设置导航里的「中医 · 经方」整节都不会出现。
  id: 'dsh-tcm-xueli',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    var React = require('react');
    var ui = require('@deepseek-ai/dsh-client-ui-primitives');

    var E = React.createElement;
    var useState = React.useState;
    var useEffect = React.useEffect;

    /** 与本插件行 id 一致，也就是 configForms 的命名空间。 */
    var NS = 'dsh-tcm-xueli';
    var TAG = '[dsh-tcm-xueli]';

    var DEFAULT_NOTE = '不设默认目录：请自己填一个资料库目录。这一项没填之前，插件不建索引、不归档医案、不补随包经典。中医会话查书、生成索引、归档医案都放在你填的这个目录里。';
    // 资料库文件夹叫什么由用户定，不再卡死名字：只校验是不是完整路径。
    // 学习版与完整版各填各的目录，插件只读自己这一份配置，不会串库。
    var PATH_HINT = '写完整路径就行，文件夹叫什么都可以，例如 D:/中医工作区/中医经方学习版资料库';


    /** 完整路径：Windows 盘符、UNC 共享（\\\\server\\share），或 POSIX 的 / 、~ 开头。 */
    var FULL_PATH = /^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+|\/(?!\/)|~[\\/]|~$)/;

    var muted = {
      margin: 0,
      fontSize: 16,
      lineHeight: 1.8,
      color: 'var(--dsw-alias-text-secondary, #666)',
    };

    /** 订阅一份设置表单，拿到当前快照。 */
    function useSnapshot(form) {
      var pair = useState(function () {
        return form && typeof form.getSnapshot === 'function' ? form.getSnapshot() : null;
      });
      var snapshot = pair[0];
      var setSnapshot = pair[1];

      useEffect(function () {
        if (!form || typeof form.subscribe !== 'function') return undefined;
        var sync = function () {
          setSnapshot(form.getSnapshot());
        };
        sync();
        return form.subscribe(sync);
      }, [form]);

      return snapshot;
    }

    function noteNode(note) {
      if (note === null) return null;
      var color = note.kind === 'ok'
        ? 'var(--dsw-alias-state-success-primary, #2e7d32)'
        : note.kind === 'warn'
          ? 'var(--dsw-alias-state-warning-primary, #a15c00)'
          : 'var(--dsw-alias-state-error-primary, #c62828)';
      return E('p', { style: { margin: 0, fontSize: 16, lineHeight: 1.8, color: color } }, note.text);
    }

    /** 组件渲染时再取一次表单：configForms 晚到也能接上。 */
    function resolveForm(props) {
      if (props.form) return props.form;
      try {
        var ctx = props.ctx;
        if (!ctx || typeof ctx.get !== 'function') return null;
        var forms = ctx.get('configForms');
        if (!forms || typeof forms.get !== 'function') return null;
        return forms.get(NS);
      } catch (error) {
        return null;
      }
    }

    function Card(props) {
      var form = resolveForm(props);

      // hooks 必须无条件先调：form 晚到、或某次重渲染才拿到 form 时，
      // 提前 return 会让两次渲染的 hook 数量不同，React 直接抛
      // 「Rendered more hooks than during the previous render」，整个设置节跟着报错。
      var snapshot = useSnapshot(form);
      var status = snapshot === null ? 'loading' : snapshot.status;
      var saved = status === 'ready' && snapshot.value && typeof snapshot.value.kbPath === 'string'
        ? snapshot.value.kbPath
        : '';

      var draftPair = useState(saved);
      var draft = draftPair[0];
      var setDraft = draftPair[1];
      var dirtyPair = useState(false);
      var dirty = dirtyPair[0];
      var setDirty = dirtyPair[1];
      var notePair = useState(null);
      var note = notePair[0];
      var setNote = notePair[1];
      var busyPair = useState(false);
      var busy = busyPair[0];
      var setBusy = busyPair[1];

      useEffect(function () {
        if (!dirty) setDraft(saved);
      }, [saved, dirty]);

      // 全部 hook 之后才允许早退：设置服务晚到时也保持同样的 hook 顺序。
      if (!form) {
        return E('div', { style: { maxWidth: 720 } },
          E('h2', { style: { margin: '0 0 6px', fontSize: 20, fontWeight: 600 } }, '中医 · 经方（学习版）｜资料库目录'),
          E('p', { style: muted }, '设置服务还没准备好，稍等片刻或重启 DSH 后再试。'));
      }

      var save = function () {
        if (busy) return;
        var text = String(draft).trim();
        if (text !== '' && !FULL_PATH.test(text)) {
          setNote({ kind: 'err', text: '请填写完整路径，' + PATH_HINT });
          return;
        }
        setBusy(true);
        setNote(null);
        var write = text === '' ? form.unset('kbPath') : form.set('kbPath', text);
        Promise.resolve(write).then(function (accepted) {
          if (accepted === false) {
            setNote({ kind: 'err', text: '保存失败：设置没有接受这个路径，请确认写的是完整路径后重试。' });
            return;
          }
          setDirty(false);
          setNote({
            kind: 'ok',
            text: text === '' ? '已清空：清空后插件不建索引、不归档，也不会再引书讲方。' : '已保存，下一句话就按新目录找书。',
          });
        }, function (error) {
          setNote({
            kind: 'err',
            text: '保存失败：' + (error && error.message ? error.message : String(error)),
          });
        }).then(function () {
          setBusy(false);
        });
      };

      if (status === 'unavailable') {
        return E('div', { style: { maxWidth: 720 } },
          E('h2', { style: { margin: '0 0 6px', fontSize: 20, fontWeight: 600 } }, '中医 · 经方（学习版）｜资料库目录'),
          E('p', { style: muted }, '这个设置项当前不可用：中医预设插件没有加载成功。'));
      }

      return E('div', { style: { maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 14 } },
        E('div', null,
          E('h2', { style: { margin: '0 0 6px', fontSize: 20, fontWeight: 600 } }, '中医 · 经方（学习版）｜资料库目录'),
          E('p', { style: muted },
            '本插件与「中医 · 经方（学习版）」预设配套，仅供学习研究使用：只讲辨证思路，不给具体剂量，不出处方笺；针灸只给推荐穴位。它是学习版，与另一个「中医 · 经方（完整版）」是两个插件，资料库各填各的，别混用。'),
          E('p', { style: muted }, DEFAULT_NOTE)),
        // 首次启用、还没填路径时，卡片最上方单独一条醒目提示，别让人错过。
        status === 'ready' && saved === ''
          ? E('div', {
            role: 'note',
            style: {
              padding: '12px 14px',
              borderRadius: 10,
              border: '1px solid #e0b34d',
              background: '#fff8e6',
              color: '#6b4c00',
              lineHeight: 1.8,
              fontSize: 15,
            },
          },
          E('strong', null, '先填资料库目录，插件才会工作。'),
          E('div', null,
            '第一次用还没有设定资料库：在上面这个框里填一个你自己的目录，点保存。'
              + '哪个盘都行，新建一个空文件夹填进去就可以，不必是某个固定的盘。'
              + '没填之前，它不建索引、不归档医案、不补随包经典，回答也只会给治法方向，不引书、不报方名。'))
          : null,
        E('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
          E('div', { style: { flex: '1 1 auto', minWidth: 0 } },
            E(ui.Input, {
              value: draft,
              placeholder: PATH_HINT,
              spellCheck: false,
              autoComplete: 'off',
              style: { width: '100%', boxSizing: 'border-box' },
              onChange: function (event) {
                setDirty(true);
                setNote(null);
                setDraft(event.target.value);
              },
              onKeyDown: function (event) {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  save();
                }
              },
            })),
          E(ui.Button, {
            variant: 'primary',
            size: 'md',
            disabled: busy || !dirty,
            onClick: save,
          }, busy ? '保存中…' : '保存')),
        E('p', { style: muted },
          '当前生效：' + (saved === '' ? '未设置' : saved) + '　清空后保存即停止使用资料库。'),
        E('p', { style: muted },
          '索引.md 由插件按上面的目录自动生成：DSH 启动时建一次，书目增删后自动更新；'
            + '同一目录只会挂一份目录监视，重复加载也不会重复写。'),
        noteNode(note));
    }

    var register = function (ctx, form) {
      try {
        var injected = function () {
          return { form: form, ctx: ctx };
        };
        if (ctx.slots && typeof ctx.slots.register === 'function') {
          return ctx.slots.register({
            name: 'settings.section',
            id: NS,
            order: 60,
            label: '中医 · 经方（学习版）',
            inject: injected,
          }, Card);
        }
      } catch (error) {
        console.warn(TAG + ' 设置卡片注册失败：', error && error.message ? error.message : error);
      }
      return undefined;
    };

    // ── 左侧「经方学习版」入口 + 工作台（左列历史会话，右列当前会话）──────────
    //
    // 点左侧的「学」图标，主区域换成学习版工作台：左列是本预设（dsh-tcm-xueli）
    // 的历史会话，右列是当前这一局的聊天，「新建会话」就在右列开一局。
    // 聊天区装配官方会话视图（conversation.content），跟正常聊天页一样有输入框。

    var Ctx = null;
    var WB_PANEL = 'xueli-wb';
    var WB_PRESET = 'dsh-tcm-xueli';
    var WB_LOG = '[学习版工作台] ';
    var WB_TITLE = '经方学习版工作台';
    var WB_CHAT_SLOT = 'xueli.wb.chat';

    function wbReason(error) {
      return String(error && error.message ? error.message : error);
    }

    function wbCss() {
      if (typeof document === 'undefined') return;
      if (document.getElementById('xw-style')) return;
      var style = document.createElement('style');
      style.id = 'xw-style';
      style.textContent = [
        '.xw-wrap{display:flex;flex-direction:column;height:100%;min-height:0;font-size:13px}',
        '.xw-head{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid rgba(127,127,127,.18);flex:none}',
        '.xw-brand{font-weight:600;font-size:13px;margin-right:auto}',
        '.xw-btn{border:1px solid rgba(127,127,127,.3);background:transparent;color:inherit;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;line-height:18px}',
        '.xw-btn:hover{background:rgba(127,127,127,.12)}',
        '.xw-btn.pri{background:#3b6ef5;border-color:#3b6ef5;color:#fff}',
        '.xw-btn.pri:hover{background:#2f5ed8}',
        '.xw-btn:disabled{opacity:.55;cursor:default}',
        '.xw-body{display:flex;flex:1;min-height:0}',
        '.xw-side{width:268px;flex:none;border-right:1px solid rgba(127,127,127,.18);display:flex;flex-direction:column;min-height:0}',
        '.xw-search{margin:6px;padding:5px 8px;font-size:12px;border:1px solid rgba(127,127,127,.3);border-radius:6px;background:transparent;color:inherit;outline:none;flex:none}',
        '.xw-now{display:flex;align-items:center;gap:6px;padding:0 10px 6px;font-size:11.5px;opacity:.7;flex:none}',
        '.xw-now .dot{width:6px;height:6px;border-radius:50%;background:#3b6ef5;flex:none}',
        '.xw-now .name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.xw-items{flex:1;min-height:0;overflow-y:auto;padding:0 6px 6px}',
        '.xw-item{position:relative;padding:7px 9px;border-radius:8px;cursor:pointer;margin-bottom:2px}',
        '.xw-ops{display:none;gap:4px;margin-top:4px}',
        '.xw-item:hover .xw-ops,.xw-item.on .xw-ops{display:flex}',
        '.xw-mini{border:1px solid rgba(127,127,127,.3);background:transparent;color:inherit;border-radius:5px;padding:1px 7px;font-size:11px;cursor:pointer;line-height:16px}',
        '.xw-mini:hover{background:rgba(127,127,127,.14)}',
        '.xw-mini.danger{color:#d9534f;border-color:rgba(217,83,79,.5)}',
        '.xw-inline{width:100%;padding:4px 6px;font-size:12px;border:1px solid rgba(127,127,127,.4);border-radius:5px;background:transparent;color:inherit;outline:none}',
        '.xw-item{padding:7px 9px;border-radius:8px;cursor:pointer;margin-bottom:2px}',
        '.xw-item:hover{background:rgba(127,127,127,.12)}',
        '.xw-item.on{background:rgba(59,110,245,.14)}',
        '.xw-item .t{font-size:12.5px;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.xw-item .m{font-size:11px;opacity:.55;line-height:16px;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.xw-main{flex:1;min-width:0;display:flex;flex-direction:column;min-height:0}',
        '.xw-chat{flex:1 1 auto;height:calc(100vh - 168px);min-height:360px;display:flex;flex-direction:column;overflow:hidden}',
        '.xw-chat>*{flex:1 1 auto;min-height:0}',
        '.xw-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:24px;text-align:center}',
        '.xw-empty .big{font-size:15px;font-weight:600}',
        '.xw-hint{font-size:12px;opacity:.62;line-height:18px}',
        '.xw-err{color:#d9534f}',
        '.xw-arch{display:flex;align-items:center;gap:8px;padding:6px 10px;background:#fff7e6;border-bottom:1px solid #f0d9a8;color:#8a6100;font-size:12px}',
        '.xw-tag{margin-left:6px;padding:0 5px;border-radius:3px;background:#eee;color:#888;font-size:11px}',
        '.xw-btn.on{background:#e8f0ff;border-color:#9bb8f2;color:#2a5bb8}'
        + '.xw-arch>span{flex:1}',
      ].join('');
      document.head.appendChild(style);
    }

    function wbSessions() {
      return svcOf('sessions');
    }

    // 官方接口偶尔不回调：给个上限，别让按钮一直转圈。
    function wbTimeout(promise, ms, label) {
      return new Promise(function (resolve, reject) {
        var timer = setTimeout(function () { reject(new Error(label + '超时（' + Math.round(ms / 1000) + ' 秒没回话）')); }, ms);
        Promise.resolve(promise).then(
          function (value) { clearTimeout(timer); resolve(value); },
          function (error) { clearTimeout(timer); reject(error); });
      });
    }

    function wbTime(ms) {
      var t = Number(ms) || 0;
      if (!t) return '';
      try {
        var d = new Date(t);
        var now = new Date();
        var pad = function (n) { return (n < 10 ? '0' : '') + n; };
        var hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
        if (d.toDateString() === now.toDateString()) return '今天 ' + hm;
        return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + hm;
      } catch (error) {
        return '';
      }
    }

    function WbChatOnly(props) {
      return props.renderSlot('conversation.session', { view: 'chat' });
    }

    function WbChatSlot(props) {
      try {
        return props.renderFactorySlot('conversation.content', { variant: 'embedded', phase: 'active' }, {
          slots: { views: WbChatOnly },
        });
      } catch (error) {
        console.warn(WB_LOG + '聊天区没画出来：', wbReason(error));
        return E('div', { className: 'xw-hint xw-err' }, '聊天区没画出来：' + wbReason(error));
      }
    }

    /** 右列：先跟宿主绑定这一局会话，再用 SessionProvider 圈定，然后画插槽。 */
    function WbChatPane(props) {
      // 绑定的那一局连同 id 一起存成状态：换局时绝不会把上一局已经释放的
      // 句柄交给会话组件（那正是「Session reference is released」报错的来源）。
      var holdState = useState(null);
      var hold = holdState[0];
      var setHold = holdState[1];
      var tick = useState(0);
      var force = tick[1];
      var sessionId = props.sessionId;
      // 归档过的会话，官方在发送这一步会静默拦住（消息进去、没有回复、也不报错），
      // 所以面板里先看它归没归档，归档了就摆个「恢复继续」。
      var archPair = useState('');
      var archMsg = archPair[0];
      var setArchMsg = archPair[1];
      useEffect(function () {
        var read = function () {
          var ws = Ctx && Ctx.workspaces;
          var snap = ws && ws.list && typeof ws.list.getSnapshot === 'function' ? ws.list.getSnapshot() : null;
          var list = (snap && snap.archivedSessionIds) || [];
          setArchMsg(sessionId && list.indexOf(sessionId) >= 0 ? '这一局已归档，恢复后才能接着问。' : '');
        };
        read();
        var ws = Ctx && Ctx.workspaces;
        if (ws && ws.list && typeof ws.list.subscribe === 'function') return ws.list.subscribe(read);
        return undefined;
      }, [sessionId]);
      var reviveArchived = function () {
        if (!sessionId) return;
        Promise.resolve(Ctx.uiWorkspace.unarchiveSession(sessionId)).then(function () {
          setArchMsg('');
        }).catch(function (error) { setArchMsg('恢复失败：' + wbReason(error)); });
      };

      useEffect(function () {
        if (!sessionId) {
          setHold(null);
          return undefined;
        }
        var svc = wbSessions();
        if (!svc || typeof svc.retain !== 'function') {
          console.warn(WB_LOG + '会话服务不支持 retain，聊天区无法绑定');
          return undefined;
        }
        var alive = true;
        var ref = null;
        try {
          ref = svc.retain(sessionId, { source: 'tcmXueli' });
        } catch (error) {
          console.warn(WB_LOG + '绑定这一局失败：', wbReason(error));
          return undefined;
        }
        setHold({ id: sessionId, ref: ref });
        Promise.resolve(ref.ready).then(
          function () { if (alive) force(function (n) { return n + 1; }); },
          function (error) {
            if (!alive) return;
            console.warn(WB_LOG + '这一局打不开：', wbReason(error));
            setHold(null);
          },
        );
        return function () {
          alive = false;
          setHold(null);
          // 延后一拍再释放：这次提交里会话组件可能还在读它，立刻释放就报 released。
          setTimeout(function () {
            try { ref.release(); } catch (error) { /* 已释放 */ }
          }, 0);
        };
      }, [sessionId]);

      if (!sessionId) return null;
      if (!props.SessionProvider || !props.renderSlot) {
        return E('div', { className: 'xw-empty' },
          E('div', { className: 'xw-hint xw-err' }, '聊天区没接上（会话组件不可用）。从托盘完全退出 DSH 再启动一次。'));
      }
      if (!hold || hold.id !== sessionId) {
        return E('div', { className: 'xw-empty' }, E('div', { className: 'xw-hint' }, '正在打开这一局…'));
      }
      var ref = hold.ref;
      var drawn;
      var chatSlot = props.chatSlot || WB_CHAT_SLOT;
      try {
        drawn = E(props.SessionProvider, { session: ref }, props.renderSlot(chatSlot, {}));
      } catch (error) {
        console.warn(WB_LOG + '聊天区渲染失败：', wbReason(error));
        drawn = E('div', { className: 'xw-hint xw-err' }, '聊天区没画出来：' + wbReason(error));
      }
      return E('div', { className: 'xw-chat' },
        archMsg ? E('div', { className: 'xw-arch' }, E('span', null, archMsg), E('button', { className: 'xw-mini', onClick: reviveArchived }, '恢复继续')) : null,
        drawn);
    }

    // ── 面板 ────────────────────────────────────────────────────────────────

function WbPanel(props) {
          var listState = useState([]);
          var rows = listState[0];
          var setRows = listState[1];
          var idState = useState(null);
          var sessionId = idState[0];
          var setSessionId = idState[1];
          var errState = useState('');
          var err = errState[0];
          var setErr = errState[1];
          var archShowPair = useState(false);
          var showArch = archShowPair[0];
          var setShowArch = archShowPair[1];
          var qPair = useState('');
          var q = qPair[0];
          var setQ = qPair[1];
          var editPair = useState(null);
          var edit = editPair[0];
          var setEdit = editPair[1];
    
          // 扫一遍客户端会话快照：挑出本模式的会话；空白会话单独留一个待复用，
          // 免得每次点进来都新建一局空的。
          var scan = function () {
            var svc = wbSessions();
            if (!svc || !svc.list || typeof svc.list.getSnapshot !== 'function') return null;
            var snap = svc.list.getSnapshot();
            var ids = (snap && snap.ids) || [];
            var ws = Ctx && Ctx.workspaces;
            var wsnap = ws && ws.list && typeof ws.list.getSnapshot === 'function' ? ws.list.getSnapshot() : null;
            var archivedIds = (wsnap && wsnap.archivedSessionIds) || [];
            var archivedSet = {};
            for (var a = 0; a < archivedIds.length; a += 1) archivedSet[archivedIds[a]] = true;
            var out = [];
            var blankId = null;
            for (var i = 0; i < ids.length; i += 1) {
              var row = snap.byId ? snap.byId[ids[i]] : null;
              if (!row || row.parentId || row.origin === 'subagent') continue;
              var isArch = !!archivedSet[ids[i]];
              if (isArch && !showArch) continue;
              var preset = row.projectionValues && row.projectionValues.agentPreset;
              if (preset !== WB_PRESET) continue;
              if (row.blank) {
                if (!blankId) blankId = ids[i];
                continue;
              }
              var title = row.title || row.displayTitle || '';
              // 问诊局单独收在「模拟问诊」里，不混进学习版的历史列表。
              if (String(title).indexOf('问诊·局') === 0) continue;
              out.push({
                id: ids[i],
                title: title,
                at: row.updatedAt || 0,
                archived: isArch,
              });
            }
            out.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
            return { rows: out, blankId: blankId };
          };
    
          var load = function () {
            var got = scan();
            if (!got) {
              setErr('会话列表还取不到：从托盘完全退出 DSH 再启动一次。');
              return null;
            }
            setRows(got.rows);
            setErr('');
            return got;
          };
    
          // 右侧固定是一局「新会话」：有空白会话就复用，没有才建。
          var openFresh = function (knownBlankId) {
            if (knownBlankId) {
              setSessionId(knownBlankId);
              return;
            }
            var svc = wbSessions();
            if (!svc || typeof svc.create !== 'function') {
              setErr('会话服务不可用：从托盘完全退出 DSH 再启动一次。');
              return;
            }
            wbTimeout(svc.create({ agentPreset: WB_PRESET }), 20000, '建会话')
              .then(function (made) {
                var id = typeof made === 'string' ? made : made && made.id;
                if (id) setSessionId(id);
                load();
              })
              .catch(function (error) { setErr('开新会话失败：' + wbReason(error)); });
          };
    
          useEffect(function () {
            wbCss();
            // 一进来就是新会话页，不自动翻开历史那一局。
            var first = load();
            if (first) openFresh(first.blankId);
            var svc = wbSessions();
            var stops = [];
            if (svc && svc.list && typeof svc.list.subscribe === 'function') stops.push(svc.list.subscribe(function () { load(); }));
            // 归档会写到 workspaces 那份状态里，列表要跟着它一起重排。
            var ws = Ctx && Ctx.workspaces;
            if (ws && ws.list && typeof ws.list.subscribe === 'function') stops.push(ws.list.subscribe(function () { load(); }));
            return function () { for (var i = 0; i < stops.length; i += 1) { try { stops[i](); } catch (error) { /* 已退订 */ } } };
          }, []);
    
          useEffect(function () { load(); }, [showArch]);

          var newOne = function () {
            var got = load() || { blankId: null };
            openFresh(got.blankId);
          };
    
          var openInChat = function (maybeId) {
            var id = maybeId || sessionId;
            if (!id) return;
            try {
              Ctx.uiWorkspace.openSession(id);
              Ctx.layout.selectPanel(null);
            } catch (error) {
              setErr('打开会话失败：' + wbReason(error));
            }
          };
    
          var doRename = function (id, title) {
            var svc = wbSessions();
            var text = String(title === undefined ? '' : title).trim();
            setEdit(null);
            if (!text) { setErr('名字不能是空的'); return; }
            if (!svc || typeof svc.using !== 'function') { setErr('会话服务不支持改名'); return; }
            Promise.resolve(svc.using(id, { source: 'qihuangWorkbench' }, function (ref) {
              return Promise.resolve(ref.ready).then(function (bound) {
                return bound.session.rename(text);
              });
            })).then(function () { load(); })
              .catch(function (error) { setErr('改名失败：' + wbReason(error)); });
          };
    
          var doRestore = function (id) {
            if (!Ctx || !Ctx.uiWorkspace || typeof Ctx.uiWorkspace.unarchiveSession !== 'function') {
              setErr('会话服务不支持恢复');
              return;
            }
            Promise.resolve(Ctx.uiWorkspace.unarchiveSession(id))
              .then(function () { load(); })
              .catch(function (error) { setErr('恢复失败：' + wbReason(error)); });
          };

          var doRemove = function (id) {
            setEdit(null);
            if (!Ctx || !Ctx.uiWorkspace || typeof Ctx.uiWorkspace.archiveSession !== 'function') {
              setErr('会话服务不支持归档');
              return;
            }
            Promise.resolve(Ctx.uiWorkspace.archiveSession(id, { stopActivity: true }))
              .then(function () {
                // 先从本地列表拿掉，别等宿主回话；再让列表重新拉一遍。
                setRows(function (old) { return old.filter(function (row) { return row.id !== id; }); });
                var svc = wbSessions();
                if (svc && svc.list && typeof svc.list.refresh === 'function') {
                  Promise.resolve(svc.list.refresh()).then(function () { load(); }, function () { /* 拉不动就保持现状 */ });
                } else {
                  load();
                }
                if (id === sessionId) openFresh(null);
              })
              .catch(function (error) { setErr('归档失败：' + wbReason(error)); });
          };
    
          // 左侧第一行永远是右侧这一局的名字，好知道现在聊的是哪一局。
          var currentTitle = '新会话';
          for (var k = 0; k < rows.length; k += 1) {
            if (rows[k].id === sessionId) currentTitle = rows[k].title || '（没起标题的会话）';
          }
          var word = String(q || '').trim().toLowerCase();
          var shown = rows.filter(function (row) {
            if (!word) return true;
            return String(row.title || '').toLowerCase().indexOf(word) >= 0;
          });
    
          var rowView = function (row) {
            var isOn = row.id === sessionId;
            var editing = edit && edit.id === row.id;
            if (editing && edit.kind === 'rename') {
              return E('div', { key: row.id, className: 'xw-item on' },
                E('input', {
                  className: 'xw-inline',
                  autoFocus: true,
                  value: edit.text,
                  onChange: function (e) { setEdit({ id: row.id, kind: 'rename', text: e.target.value }); },
                  onKeyDown: function (e) {
                    if (e.key === 'Enter') doRename(row.id, edit.text);
                    if (e.key === 'Escape') setEdit(null);
                  },
                }),
                E('div', { className: 'xw-ops' },
                  E('button', { className: 'xw-mini', onClick: function () { doRename(row.id, edit.text); } }, '保存'),
                  E('button', { className: 'xw-mini', onClick: function () { setEdit(null); } }, '取消')));
            }
            if (editing && edit.kind === 'remove') {
              return E('div', { key: row.id, className: 'xw-item on' },
                E('div', { className: 't' }, '归档「' + (row.title || '这一局') + '」？'),
                E('div', { className: 'm' }, '归档后从列表里收起来，还能在归档里找回。'),
                E('div', { className: 'xw-ops' },
                  E('button', { className: 'xw-mini danger', onClick: function () { doRemove(row.id); } }, '确定归档'),
                  E('button', { className: 'xw-mini', onClick: function () { setEdit(null); } }, '取消')));
            }
            return E('div', {
              key: row.id,
              className: 'xw-item' + (isOn ? ' on' : ''),
              onClick: function () { setSessionId(row.id); },
              title: row.title,
            },
              E('div', { className: 't' }, row.title || '（没起标题的会话）'),
              E('div', { className: 'm' }, wbTime(row.at), row.archived ? E('span', { className: 'xw-tag' }, '已归档') : null),
              E('div', { className: 'xw-ops' },
                row.archived
                  ? E('button', {
                    className: 'xw-mini',
                    title: '恢复',
                    onClick: function (e) { e.stopPropagation(); doRestore(row.id); },
                  }, '恢复')
                  : E('button', {
                    className: 'xw-mini',
                    title: '改名',
                    onClick: function (e) { e.stopPropagation(); setEdit({ id: row.id, kind: 'rename', text: row.title || '' }); },
                  }, '改名'),
                row.archived ? null : E('button', {
                  className: 'xw-mini danger',
                  title: '归档',
                  onClick: function (e) { e.stopPropagation(); setEdit({ id: row.id, kind: 'remove' }); },
                }, '归档')));
          };
    
          return E('div', { className: 'xw-wrap' },
            E('div', { className: 'xw-head' },
              E('span', { className: 'xw-brand' }, WB_TITLE),
              E('button', { className: 'xw-btn pri', onClick: newOne }, '新建会话'),
              E('button', { className: 'xw-btn', onClick: openInChat, disabled: !sessionId }, '去聊天页'),
              E('button', { className: 'xw-btn' + (showArch ? ' on' : ''), onClick: function () { setShowArch(!showArch); } }, showArch ? '收起归档' : '显示已归档'),
              E('button', { className: 'xw-btn', onClick: load }, '刷新')),
            E('div', { className: 'xw-body' },
              E('div', { className: 'xw-side' },
                E('input', {
                  className: 'xw-search',
                  placeholder: '搜索会话',
                  value: q,
                  onChange: function (e) { setQ(e.target.value); },
                }),
                E('div', { className: 'xw-now', title: currentTitle },
                  E('span', { className: 'dot' }),
                  E('span', { className: 'name' }, currentTitle)),
                E('div', { className: 'xw-items' },
                  shown.length === 0
                    ? E('div', { className: 'xw-hint', style: { padding: '10px 9px' } },
                      word ? '没有匹配的会话。' : '还没有历史会话，右边就是新开的一局。')
                    : shown.map(rowView))),
              E('div', { className: 'xw-main' },
                err ? E('div', { className: 'xw-hint xw-err', style: { padding: '8px 12px' } }, err) : null,
                sessionId
                  ? E(WbChatPane, {
                    sessionId: sessionId,
                    renderSlot: props.renderSlot,
                    renderFactorySlot: props.renderFactorySlot,
                    SessionProvider: props.SessionProvider,
                  })
                  : E('div', { className: 'xw-empty' },
                    E('div', { className: 'big' }, WB_TITLE),
                    E('div', { className: 'xw-hint' }, '右边这一局就是新会话，直接说话就能开始聊。')))));
        }

    function WbIcon() {
      return E('svg', {
        width: 18, height: 18, viewBox: '0 0 20 20', fill: 'none',
        xmlns: 'http://www.w3.org/2000/svg', 'aria-hidden': 'true',
      },
        E('rect', { x: 2.6, y: 2.6, width: 14.8, height: 14.8, rx: 3.6, stroke: 'currentColor', strokeWidth: 1.35 }),
        E('text', {
          x: 10, y: 14.3, textAnchor: 'middle', fontSize: 10.4,
          fill: 'currentColor', fontFamily: 'inherit',
        }, '学'));
    }

    // 官方左侧会话列表里不显示问诊局：DSH 列表只看 origin/blank，没有「隐藏」接口，
    // 所以从 DOM 层把标题带「问诊·局」的那几行藏掉。类名变了最多藏不住，不影响主体。
    var simHideTimer = null;
    // 问诊局开过的会话 id 记一份，靠它精确隐藏（标题被截断也能认出来）。
    var simRoundIds = {};

    // 这个插件自己的会话全部不在官方左栏出现：学习版有自己的工作台，
    // 官方左栏只留普通会话，免得一屏全是问诊局。
    function ownPresetIds() {
      var out = {};
      try {
        var svc = wbSessions();
        var snap = svc && svc.list && typeof svc.list.getSnapshot === 'function' ? svc.list.getSnapshot() : null;
        if (!snap) return out;
        var ids = snap.ids || [];
        for (var i = 0; i < ids.length; i += 1) {
          var row = snap.byId ? snap.byId[ids[i]] : null;
          var preset = row && row.projectionValues && row.projectionValues.agentPreset;
          if (preset === WB_PRESET) out[ids[i]] = true;
        }
      } catch (error) { /* 读不到就只按标题认 */ }
      return out;
    }

    function isSimTitle(text) {
      var t = String(text || '');
      return t.indexOf('问诊·局') >= 0 || t.indexOf('模拟问诊 · 局') >= 0;
    }

    // 官方左栏没有过滤接口，就注入一条样式表按会话行标记把本插件的会话藏掉。
    // 样式表是声明式的：React 重渲染抹不掉，不会像改内联样式那样一闪一闪。
    function ownHideStyle() {
      if (typeof document === 'undefined' || !document.head) return null;
      var el = document.getElementById('xw-hide-sim');
      if (!el) {
        el = document.createElement('style');
        el.id = 'xw-hide-sim';
        document.head.appendChild(el);
      }
      return el;
    }

    function hideSimRows() {
      try {
        var el = ownHideStyle();
        if (!el) return;
        var own = ownPresetIds();
        var ids = own;
        for (var sid in simRoundIds) { if (simRoundIds[sid] === true) ids[sid] = true; }
        var css = '';
        for (var id in ids) {
          if (ids[id] !== true) continue;
          css += '[data-row-key="session:' + id + '"]{display:none !important}';
        }
        if (el.textContent !== css) el.textContent = css;
      } catch (error) { /* 藏不住就算了 */ }
    }

    var simLate = [];

    function laterHideSimRows(ms) {
      var handle = setTimeout(hideSimRows, ms);
      simLate.push(handle);
      try { if (handle && typeof handle.unref === 'function') handle.unref(); } catch (error) { /* 没有就算了 */ }
    }

    function startHideSimRows() {
      if (simHideTimer) return;
      hideSimRows();
      laterHideSimRows(300);
      laterHideSimRows(1500);
      simHideTimer = setInterval(hideSimRows, 900);
      // 测试或非浏览器环境下别让这个定时器吊住进程。
      try { if (simHideTimer && typeof simHideTimer.unref === 'function') simHideTimer.unref(); } catch (error) { /* 没有就算了 */ }
    }

    // 插件卸载或热重载时停掉定时器，否则它会一直去改官方左栏的 DOM。
    function stopHideSimRows() {
      if (simHideTimer) {
        try { clearInterval(simHideTimer); } catch (error) { /* 没有就算了 */ }
        simHideTimer = null;
      }
      for (var i = 0; i < simLate.length; i += 1) {
        try { clearTimeout(simLate[i]); } catch (error) { /* 没有就算了 */ }
      }
      simLate = [];
    }

    function wbRegister(ctx) {
      // 只声明我们自己的子插槽（放这一局的聊天视图），scope 用 session，
      // 渲染引擎才会把 SessionProvider 注入进来，面板才能圈定「这一局」。
      var decl = {};
      decl[WB_CHAT_SLOT] = { kind: 'single', scope: 'session' };
      ctx.slots.inject('main', function () {
        return ctx.slots.register({ name: 'main', key: WB_PANEL, children: decl }, WbPanel);
      });
      ctx.slots.inject(WB_CHAT_SLOT, function () {
        return ctx.slots.register({ name: WB_CHAT_SLOT }, WbChatSlot);
      });
      ctx.slots.inject('sidebar.panellist', function () {
        return ctx.slots.register({ name: 'sidebar.panellist', id: WB_PANEL, order: 21, label: function () { return '经方学习版'; } }, WbIcon);
      });
    }

var SR_PANEL = 'xueli-search';
        var SR_PATH = '/dsh-tcm-xueli/search';
        var SR_TITLE = '资料查询';
    
        function srCss() {
          if (typeof document === 'undefined') return;
          if (document.getElementById('sr-style')) return;
          var style = document.createElement('style');
          style.id = 'sr-style';
          style.textContent = [
            '.sr-wrap{display:flex;flex-direction:column;height:100%;min-height:0;font-size:13px}',
            '.sr-head{display:flex;align-items:baseline;gap:10px;padding:10px 14px 0;flex:none}',
            '.sr-brand{font-weight:600;font-size:13px}',
            '.sr-sub{font-size:11.5px;opacity:.6}',
            '.sr-bar{display:flex;gap:8px;padding:10px 14px;flex:none}',
            '.sr-input{flex:1;min-width:0;padding:7px 10px;font-size:13px;border:1px solid rgba(127,127,127,.32);border-radius:7px;background:transparent;color:inherit;outline:none}',
            '.sr-input:focus{border-color:#3b6ef5}',
            '.sr-btn{border:1px solid #3b6ef5;background:#3b6ef5;color:#fff;border-radius:7px;padding:6px 16px;font-size:12.5px;cursor:pointer}',
            '.sr-btn:disabled{opacity:.6;cursor:default}',
            '.sr-list{flex:1;min-height:0;overflow-y:auto;padding:0 14px 14px}',
            '.sr-card{border:1px solid rgba(127,127,127,.2);border-radius:9px;padding:10px 12px;margin-bottom:10px}',
            '.sr-src{font-size:11.5px;opacity:.6;margin-bottom:6px}',
            '.sr-label{font-size:11px;opacity:.55;margin:8px 0 2px}',
            '.sr-meta-line{font-size:12.5px;line-height:1.8;margin-bottom:2px}',
            '.sr-meta-k{opacity:.55;margin-right:8px}',
            '.sr-orig{font-size:13px;line-height:1.75;white-space:pre-wrap}',
            '.sr-plain{font-size:13px;line-height:1.75;white-space:pre-wrap;color:inherit;opacity:.92}',
            '.sr-hint{font-size:12px;opacity:.62;line-height:18px;padding:2px 0}',
            '.sr-err{font-size:12px;color:#d9534f;line-height:18px;padding:0 14px 6px}',
          ].join('');
          document.head.appendChild(style);
        }
    
        function SrIcon() {
          return E('svg', {
            width: 18, height: 18, viewBox: '0 0 20 20', fill: 'none',
            xmlns: 'http://www.w3.org/2000/svg', 'aria-hidden': 'true',
          },
            E('rect', { x: 2.6, y: 2.6, width: 14.8, height: 14.8, rx: 3.6, stroke: 'currentColor', strokeWidth: 1.35 }),
            E('text', {
              x: 10, y: 14.3, textAnchor: 'middle', fontSize: 10.4,
              fill: 'currentColor', fontFamily: 'inherit',
            }, '查'));
        }
    
        function SrPanel() {
          var qState = useState('');
          var q = qState[0];
          var setQ = qState[1];
          var busyState = useState(false);
          var busy = busyState[0];
          var setBusy = busyState[1];
          var resState = useState([]);
          var res = resState[0];
          var setRes = resState[1];
          var noteState = useState('');
          var note = noteState[0];
          var setNote = noteState[1];
          var errState = useState('');
          var err = errState[0];
          var setErr = errState[1];
    
          useEffect(function () { srCss(); }, []);
    
          var run = function () {
            var text = String(q || '').trim();
            if (!text) { setErr('先输入要查的字，比如「便秘」「少阴病」。'); return; }
            setBusy(true);
            setErr('');
            setNote('');
            Promise.resolve()
              .then(function () {
                return fetch(SR_PATH + '?q=' + encodeURIComponent(text) + '&n=6', { cache: 'no-store' });
              })
              .then(function (resp) {
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                return resp.json();
              })
              .then(function (back) {
                setBusy(false);
                var got = back && Array.isArray(back.results) ? back.results : [];
                setRes(got);
                setNote(back && back.reason ? String(back.reason) : '');
              })
              .catch(function (error) {
                setBusy(false);
                setErr('查询没通：' + (error && error.message ? error.message : String(error)) + '。重启一次 DSH 再试。');
              });
          };
    
          var metaRows = function (row) {
            var meta = row.meta;
            if (!meta) return null;
            var lines = [];
            if (meta.nature) lines.push(['性味', meta.nature]);
            if (meta.effect) lines.push(['功效', meta.effect]);
            if (meta.origin) lines.push(['产地', meta.origin]);
            if (meta.alias) lines.push(['别名', meta.alias]);
            if (!lines.length) return null;
            return E('div', {}, lines.map(function (pair, k) {
              return E('div', { className: 'sr-meta-line', key: k },
                E('span', { className: 'sr-meta-k' }, pair[0]),
                E('span', { className: 'sr-meta-v' }, pair[1]));
            }));
          };

          var card = function (row, i) {
            return E('div', { className: 'sr-card', key: i },
              E('div', { className: 'sr-src' }, row.source || '资料库'),
              metaRows(row),
              E('div', { className: 'sr-label' }, '原文'),
              E('div', { className: 'sr-orig' }, row.original || ''),
              row.plain ? E('div', { className: 'sr-label' }, '白话') : null,
              row.plain
                ? E('div', { className: 'sr-plain' }, row.plain)
                : (row.meta ? null : E('div', { className: 'sr-hint' }, '这段的白话没译出来，先看原文。')));
          };
    
          return E('div', { className: 'sr-wrap' },
            E('div', { className: 'sr-head' },
              E('span', { className: 'sr-brand' }, SR_TITLE),
              E('span', { className: 'sr-sub' }, '输入简体中文，查资料库里的原文和白话')),
            E('div', { className: 'sr-bar' },
              E('input', {
                className: 'sr-input',
                placeholder: '输入要查的字，如「便秘」「少阴病」「肝主疏泄」',
                value: q,
                onChange: function (e) { setQ(e.target.value); },
                onKeyDown: function (e) { if (e.key === 'Enter') run(); },
              }),
              E('button', { className: 'sr-btn', onClick: run, disabled: busy }, busy ? '查着…' : '查询')),
            err ? E('div', { className: 'sr-err' }, err) : null,
            note ? E('div', { className: 'sr-err', style: { color: 'inherit', opacity: 0.7 } }, note) : null,
            E('div', { className: 'sr-list' },
              busy
                ? E('div', { className: 'sr-hint' }, '正在查，稍等…')
                : res.length === 0
                  ? E('div', { className: 'sr-hint' }, '还没有结果。输入两个字以上再点查询。')
                  : res.map(card)));
        }
    
        function srRegister(ctx) {
          ctx.slots.inject('main', function () {
            return ctx.slots.register({ name: 'main', key: SR_PANEL }, SrPanel);
          });
          ctx.slots.inject('sidebar.panellist', function () {
            return ctx.slots.register({
              name: 'sidebar.panellist',
              id: SR_PANEL,
              order: 23,
              label: function () { return '资料查询'; },
            }, SrIcon);
          });
        }


var SIM_PANEL = 'xueli-sim';
var SIM_CHAT_SLOT = 'xueli.sim.chat';
var SIM_TITLE = '模拟问诊';
var SIM_LEVELS = ['简单', '普通', '困难'];
var SIM_TREATS = ['方药', '针灸', '针药'];

function simCss() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('sim-style')) return;
  var style = document.createElement('style');
  style.id = 'sim-style';
  style.textContent = [
    '.sim-wrap{display:flex;flex-direction:column;height:100%;min-height:0;font-size:13px}',
    '.sim-form{flex:none;padding:12px 14px 10px;border-bottom:1px solid rgba(127,127,127,.16)}',
    '.sim-title{font-weight:600;margin-bottom:2px}',
    '.sim-sub{font-size:11.5px;opacity:.6;margin-bottom:10px}',
    '.sim-row{display:flex;align-items:center;gap:6px;margin-bottom:8px}',
    '.sim-label{font-size:12px;opacity:.62;width:34px;flex:none}',
    '.sim-chip{border:1px solid rgba(127,127,127,.32);background:transparent;color:inherit;border-radius:6px;padding:3px 12px;font-size:12px;cursor:pointer}',
    '.sim-chip.on{border-color:#3b6ef5;background:#3b6ef5;color:#fff}',
    '.sim-go{border:1px solid #3b6ef5;background:#3b6ef5;color:#fff;border-radius:7px;padding:5px 18px;font-size:12.5px;cursor:pointer;margin-top:2px}',
    '.sim-go:disabled{opacity:.6;cursor:default}',
    '.sim-full{display:flex;flex-direction:column;height:100%;min-height:0;padding:10px 12px;gap:8px}',
    '.sim-bar{display:flex;align-items:center;gap:8px;flex:0 0 auto;flex-wrap:wrap}',
    '.sim-badge{font-size:11.5px;opacity:.65;border:1px solid rgba(127,127,127,.25);border-radius:5px;padding:1px 7px}',
    '.sim-mini{border:1px solid rgba(127,127,127,.32);background:transparent;color:inherit;border-radius:6px;padding:3px 10px;font-size:12px;cursor:pointer}',
    '.sim-mini:disabled{opacity:.55;cursor:default}',
    '.sim-body{flex:1 1 auto;height:calc(100vh - 196px);min-height:360px;display:flex;flex-direction:column;overflow:hidden}',
    '.sim-body>*{flex:1;min-height:0}',
    '.sim-chat{flex:1;min-height:0;display:flex;flex-direction:column}',
    '.sim-hint{font-size:12px;opacity:.62;line-height:18px}',
    '.sim-err{font-size:12px;color:#d9534f;line-height:18px;padding:6px 0}',
    '.sim-msg{display:flex}',
    '.sim-msg.me{justify-content:flex-end}',
    '.sim-msg-body{max-width:82%;white-space:pre-wrap;word-break:break-word;border-radius:10px;padding:8px 12px;line-height:1.75;font-size:13.5px}',
    '.sim-msg.them .sim-msg-body{background:rgba(127,127,127,.12)}',
    '.sim-msg.me .sim-msg-body{background:#3b6ef5;color:#fff}',
  ].join('');
  document.head.appendChild(style);
}

function simReason(error) {
  return error && error.message ? error.message : String(error || '未知错误');
}

function simRoundId() {
  var d = new Date();
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  return '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' +
    pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}

/** 往一局会话里发一句话：先 retain，等 ready，再 prompt。 */
function simSend(id, text) {
  var svc = wbSessions();
  if (!svc || typeof svc.using !== 'function') return Promise.reject(new Error('会话服务不可用'));
  return Promise.resolve(svc.using(id, { source: 'tcmXueliSim' }, function (ref) {
    return Promise.resolve(ref.ready).then(function (bound) {
      var session = bound && bound.session;
      if (!session || typeof session.prompt !== 'function') throw new Error('这一局还没准备好');
      return wbTimeout(session.prompt([{ type: 'text', text: String(text) }], 'queue'), 20000, '发开局指令')
        .then(function (result) {
          if (result && result.ok === false) {
            throw new Error((result.error && result.error.message) || '这一局没收下这句话');
          }
        });
    });
  }));
}

function SimPanel(props) {
  var levelState = useState('普通');
  var level = levelState[0];
  var setLevel = levelState[1];
  var treatState = useState('针药');
  var treat = treatState[0];
  var setTreat = treatState[1];
  var idState = useState(null);
  var sessionId = idState[0];
  var setSessionId = idState[1];
  var roundState = useState('');
  var round = roundState[0];
  var setRound = roundState[1];
  var busyState = useState(false);
  var busy = busyState[0];
  var setBusy = busyState[1];
  var errState = useState('');
  var err = errState[0];
  var setErr = errState[1];

  useEffect(function () { simCss(); wbCss(); }, []);

  // 把这一局在会话列表里起个好认的名字；失败不影响问诊。
  var nameRound = function (id, rid, lv, td) {
    var svc = wbSessions();
    if (!svc || typeof svc.using !== 'function') return;
    try {
      svc.using(id, { source: 'tcmXueliSim' }, function (ref) {
        return Promise.resolve(ref.ready).then(function (bound) {
          var session = bound && bound.session;
          if (session && typeof session.rename === 'function') {
            return session.rename('问诊·局 ' + rid + '（' + lv + '·' + td + '）');
          }
          return null;
        });
      }).catch(function () { /* 改不动名也不影响开局 */ });
    } catch (error) { /* 同上 */ }
  };

  var openRound = function (lv, td) {
    if (busy) return;
    var svc = wbSessions();
    if (!svc || typeof svc.create !== 'function') {
      setErr('会话服务不可用：从托盘完全退出 DSH 再启动一次。');
      return;
    }
    setBusy(true);
    setErr('');
    var rid = simRoundId();
    var text = '【模拟问诊 · 开局】' + lv + '｜' + td + '｜' + rid;
    // 先按本预设建；预设一时没就绪就退回默认预设，至少不卡在这一步。
    wbTimeout(Promise.resolve(svc.create({ agentPreset: WB_PRESET })), 20000, '建会话')
      .catch(function () { return wbTimeout(Promise.resolve(svc.create({})), 20000, '建会话'); })
      .then(function (made) {
        var id = typeof made === 'string' ? made : made && made.id;
        if (!id) throw new Error('没拿到会话 id');
        simRoundIds[id] = true;
        nameRound(id, rid, lv, td);
        return simSend(id, text).then(function () { return id; });
      })
      .then(function (id) {
        setSessionId(id);
        setRound(rid);
        setBusy(false);
      })
      .catch(function (error) {
        setBusy(false);
        setErr('开局失败：' + simReason(error) + '。再点一次；反复如此就从托盘完全退出 DSH 再启动。');
      });
  };

  // 换局/换难度：旧局归档收起来，别越堆越多。
  var archiveCurrent = function () {
    var old = sessionId;
    if (!old) return;
    try {
      if (!Ctx || !Ctx.uiWorkspace || typeof Ctx.uiWorkspace.archiveSession !== 'function') return;
      Promise.resolve(Ctx.uiWorkspace.archiveSession(old)).catch(function () { /* 归档失败也不拦着开新局 */ });
    } catch (error) { /* 同上 */ }
  };

  var start = function () { openRound(level, treat); };

  var restartSame = function () {
    if (busy) return;
    archiveCurrent();
    setSessionId(null);
    setRound('');
  };

  var backToForm = function () {
    if (busy) return;
    archiveCurrent();
    setSessionId(null);
    setRound('');
    setErr('');
  };

  var goChat = function () {
    if (!sessionId) return;
    try { Ctx.uiWorkspace.openSession(sessionId); } catch (error) { /* 打不开就留在面板里 */ }
    try { Ctx.layout.selectPanel(null); } catch (error) { /* 同上 */ }
  };

  var chips = function (list, now, pick) {
    return list.map(function (one) {
      return E('button', {
        key: one,
        className: 'sim-chip' + (one === now ? ' on' : ''),
        onClick: function () { pick(one); },
      }, one);
    });
  };

  // 开局之后：整页交给诊室，聊天拉满，输入框才不会被挤掉。
  if (sessionId) {
    return E('div', { className: 'sim-full' },
      E('div', { className: 'sim-bar' },
        E('span', { className: 'sim-badge' }, level + ' · ' + treat),
        E('span', { className: 'sim-badge' }, '局号 ' + (round || '—')),
        E('button', { className: 'sim-mini', onClick: backToForm, disabled: busy }, '换难度重开'),
        E('button', { className: 'sim-mini', onClick: start, disabled: busy }, busy ? '正在开局…' : '同设置再来一局'),
        E('button', { className: 'sim-mini', onClick: goChat }, '去会话页')),
      err ? E('div', { className: 'sim-err' }, err) : null,
      E('div', { className: 'sim-body' },
        E(WbChatPane, {
          sessionId: sessionId,
          chatSlot: SIM_CHAT_SLOT,
          renderSlot: props.renderSlot,
          renderFactorySlot: props.renderFactorySlot,
          SessionProvider: props.SessionProvider,
        })));
  }

  return E('div', { className: 'sim-wrap' },
    E('div', { className: 'sim-form' },
      E('div', { className: 'sim-title' }, SIM_TITLE),
      E('div', { className: 'sim-sub' }, '选好难度和方向，点「开始一局」——病人（子模型）在右边的诊室里先开口，你扮医生一问一答，全程不用离开这个页面。说「交卷」裁判当场逐条指正。'),
      E('div', { className: 'sim-row' },
        E('span', { className: 'sim-label' }, '难度'),
        chips(SIM_LEVELS, level, setLevel)),
      E('div', { className: 'sim-row' },
        E('span', { className: 'sim-label' }, '方向'),
        chips(SIM_TREATS, treat, setTreat)),
      E('button', { className: 'sim-go', onClick: start, disabled: busy }, busy ? '正在开局…' : '开始一局'),
      err ? E('div', { className: 'sim-err' }, err) : null),
    E('div', { className: 'sim-hint', style: { padding: '12px 14px' } },
      '开局之后这里就是诊室。交卷时裁判按内经难经、仲景法度、脉经、甲乙经逐条指正，只给过关／边缘／不过关，不给剂量。'));
}
function SimIcon() {
  return E('svg', {
    width: 18, height: 18, viewBox: '0 0 20 20', fill: 'none',
    xmlns: 'http://www.w3.org/2000/svg', 'aria-hidden': 'true',
  },
    E('rect', { x: 2.6, y: 2.6, width: 14.8, height: 14.8, rx: 3.6, stroke: 'currentColor', strokeWidth: 1.35 }),
    E('text', {
      x: 10, y: 14.3, textAnchor: 'middle', fontSize: 10.4,
      fill: 'currentColor', fontFamily: 'inherit',
    }, '诊'));
}

function simRegister(ctx) {
  startHideSimRows();
  var decl = {};
  decl[SIM_CHAT_SLOT] = { kind: 'single', scope: 'session' };
  ctx.slots.inject('main', function () {
    return ctx.slots.register({ name: 'main', key: SIM_PANEL, children: decl }, SimPanel);
  });
  ctx.slots.inject(SIM_CHAT_SLOT, function () {
    return ctx.slots.register({ name: SIM_CHAT_SLOT }, WbChatSlot);
  });
  ctx.slots.inject('sidebar.panellist', function () {
    return ctx.slots.register({
      name: 'sidebar.panellist',
      id: SIM_PANEL,
      order: 24,
      label: function () { return '模拟问诊'; },
    }, SimIcon);
  });
}

    exports.name = 'dsh-tcm-xueli/client';
    exports.inject = ['slots', 'sessions', 'layout', 'uiWorkspace', 'workspaces'];

    exports.apply = function (ctx) {
      try {
        if (!ctx.slots || typeof ctx.slots.inject !== 'function') {
          console.warn(TAG + ' 缺少 slots 服务，设置卡片不挂载');
          return;
        }
        Ctx = ctx;
        try {
          if (typeof ctx.effect === 'function') {
            ctx.effect(function () { return function () { stopHideOwnRows(); stopHideSimRows(); }; });
          }
        } catch (error) { /* 老内核没有 effect 就算了 */ }
        try {
          wbRegister(ctx);
        } catch (error) {
          console.warn(TAG + ' 学习版入口挂载失败：', error && error.message ? error.message : error);
        }
        try {
          srRegister(ctx);
        } catch (error) {
          console.warn(TAG + ' 资料查询入口挂载失败：', error && error.message ? error.message : error);
        }
        try {
          simRegister(ctx);
        } catch (error) {
          console.warn(TAG + ' 模拟问诊入口挂载失败：', error && error.message ? error.message : error);
        }
        ctx.slots.inject('settings.section', function () {
          var form = null;
          try {
            ctx.inject(['configForms'], function (fctx) {
              try {
                var forms = fctx && fctx.configForms;
                if (forms && typeof forms.get === 'function') form = forms.get(NS);
              } catch (error) {
                console.warn(TAG + ' 读取设置表单失败：', error && error.message ? error.message : error);
              }
            });
          } catch (error) {
            console.warn(TAG + ' configForms 接线失败：', error && error.message ? error.message : error);
          }
          return register(ctx, form);
        });
      } catch (error) {
        console.warn(TAG + ' 客户端半加载失败：', error && error.message ? error.message : error);
      }
    };

    return module.exports;
  },
});