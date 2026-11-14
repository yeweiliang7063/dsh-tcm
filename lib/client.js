/**
 * 学理模式 · 浏览器半（手写 ModuleLoader bundle，无构建步骤）
 *
 * 一个座位：设置页左侧导航里的「中医资料库 · 学理模式」一节。
 * 里面只有一项设置：资料库目录。
 * 改完保存，下一句话就按新目录找书，不用重启。
 */
window.__ModuleLoader__.load({
  id: 'dsh-tcm',
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
    var NS = 'dsh-tcm';
    var TAG = '[dsh-tcm]';

    var DEFAULT_NOTE = '默认目录：Windows 用 D:\\中医知识库，macOS / Linux 用 ~/中医知识库。中医会话查书、生成索引、归档医案都放在这个目录里。';
    var PATH_HINT = '例如 D:\\中医知识库、/Users/你/中医知识库 或 ~/中医知识库';

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

      if (!form) {
        return E('div', { style: { maxWidth: 720 } },
          E('h2', { style: { margin: '0 0 6px', fontSize: 20, fontWeight: 600 } }, '中医资料库 · 学理模式'),
          E('p', { style: muted }, '设置服务还没准备好，稍等片刻或重启 DSH 后再试。'));
      }

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
            text: text === '' ? '已恢复默认目录，下次提问生效。' : '已保存，下一句话就按新目录找书。',
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
          E('h2', { style: { margin: '0 0 6px', fontSize: 20, fontWeight: 600 } }, '中医资料库 · 学理模式'),
          E('p', { style: muted }, '这个设置项当前不可用：中医预设插件没有加载成功。'));
      }

      return E('div', { style: { maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 14 } },
        E('div', null,
          E('h2', { style: { margin: '0 0 6px', fontSize: 20, fontWeight: 600 } }, '中医资料库 · 学理模式'),
          E('p', { style: muted },
            '本插件与「中医 · 岐黄经方（学习版）」预设仅供学习研究使用：只讲辨证思路，不给具体剂量，不出处方笺；针灸只给推荐穴位。'),
          E('p', { style: muted }, DEFAULT_NOTE)),
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
          '当前生效：' + (saved === '' ? '未设置，使用默认目录' : saved) + '　留空保存即恢复默认。'),
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
            label: '中医资料库',
            inject: injected,
          }, Card);
        }
      } catch (error) {
        console.warn(TAG + ' 设置卡片注册失败：', error && error.message ? error.message : error);
      }
      return undefined;
    };

    exports.name = 'dsh-tcm/client';
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