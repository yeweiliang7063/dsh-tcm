/**
 * 学理模式 · 浏览器半（手写 ModuleLoader bundle，无构建步骤）
 *
 * 一个座位：设置页左侧导航里的「中医 · 经方｜资料库目录」一节。
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
    // 资料库文件夹的名字是固定的，盘符不限；填错名字就不保存，免得两个插件互相认错库。
    var KB_DIR_NAME = '中医 · 经方资料库';
    var PATH_HINT = '最后一级文件夹必须叫「' + KB_DIR_NAME + '」，盘符随意，例如 D:\\中医工作区\\' + KB_DIR_NAME + '、F:\\' + KB_DIR_NAME;

    // 取路径最后一级目录名：两种分隔符都认，末尾斜杠忽略。
    var lastSegment = function (p) {
      var t = String(p || '').replace(/[\\/]+$/, '');
      var cut = Math.max(t.lastIndexOf('/'), t.lastIndexOf('\\'));
      return cut >= 0 ? t.slice(cut + 1) : t;
    };
    // 不预设任何盘符：目录由用户自己定，想放 C 盘、E 盘、移动硬盘都行。

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

      if (!form) {
        return E('div', { style: { maxWidth: 720 } },
          E('h2', { style: { margin: '0 0 6px', fontSize: 20, fontWeight: 600 } }, '中医 · 经方｜资料库目录'),
          E('p', { style: muted }, '设置服务还没准备好，稍等片刻或重启 DSH 后再试。'));
      }

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

      var save = function () {
        if (busy) return;
        var text = String(draft).trim();
        if (text !== '' && !FULL_PATH.test(text)) {
          setNote({ kind: 'err', text: '请填写完整路径，' + PATH_HINT });
          return;
        }
        if (text !== '' && lastSegment(text) !== KB_DIR_NAME) {
          setNote({
            kind: 'err',
            text: '资料库文件夹必须叫「' + KB_DIR_NAME + '」，你现在填的最后一级是「' + lastSegment(text) + '」，换个名字或新建一个同名文件夹再保存。',
          });
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
          E('h2', { style: { margin: '0 0 6px', fontSize: 20, fontWeight: 600 } }, '中医 · 经方｜资料库目录'),
          E('p', { style: muted }, '这个设置项当前不可用：中医预设插件没有加载成功。'));
      }

      return E('div', { style: { maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 14 } },
        E('div', null,
          E('h2', { style: { margin: '0 0 6px', fontSize: 20, fontWeight: 600 } }, '中医 · 经方｜资料库目录'),
          E('p', { style: muted },
            '本插件与「中医 · 经方（学习版）」预设仅供学习研究使用：只讲辨证思路，不给具体剂量，不出处方笺；针灸只给推荐穴位。'),
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
            label: '中医 · 经方',
            inject: injected,
          }, Card);
        }
      } catch (error) {
        console.warn(TAG + ' 设置卡片注册失败：', error && error.message ? error.message : error);
      }
      return undefined;
    };

    exports.name = 'dsh-tcm-xueli/client';
    exports.inject = ['slots'];

    exports.apply = function (ctx) {
      try {
        if (!ctx.slots || typeof ctx.slots.inject !== 'function') {
          console.warn(TAG + ' 缺少 slots 服务，设置卡片不挂载');
          return;
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