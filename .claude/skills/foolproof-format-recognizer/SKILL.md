---
name: foolproof-format-recognizer
description: 「用户是傻瓜」原则 — 适用于所有对用户输入做格式识别 / 转换 / 注入结果行的代码路径（百家姓 / magnet / hex / ed2k / URL / YouTube 等）。当新增识别类型、调整截断逻辑、修识别准确率 bug 时必读。
when_to_use: 新增识别类型；调整 bjxToMagnet 的直通 / 截断 / 校验层；调整 collectHits 守卫；改预览按钮挂载规则
when_not_to_use: 调整 whatslink API / 缓存（→ whatslink-preview）；改 UI 视觉（→ ui-style）
---

# foolproof-format-recognizer — 「用户是傻瓜」原则

> 原文：「用户输入什么都有可能，我们要把用户当作傻瓜，所以我们的代码要用最傻瓜的方式保证用户体验。」

适用于所有**对用户输入做格式识别 / 转换 / 注入结果行**的代码路径，不限于 bjx。

## 核心四条

1. **多挂不如少挂**：误挂一行可疑链接（污染阅读 + 误导用户 + 可能被骗）的代价 >> 漏挂。
2. **直通优于截断**：识别出来的真实协议（magnet / http(s) / ed2k）原样返回，让用户自己判断。**不替用户做安全判断**。
3. **真实格式优先直通**：识别函数里，先尝试匹配完整 magnet → URL → ed2k，三者命中直接 return；只有都不是时才走「截到第一个非 hex」兜底。
4. **预览按钮是最终兜底**：挂出的链接点预览可验证真伪；不要在识别阶段就替用户决定「这是不是合法 magnet」。

## 落地表现（`src/utils/bjx.ts` + `src/content/bjx.ts` 当前实现）

`bjxToMagnet` 三层直通 + 一层截断 + 一层弱校验 + content 层兜底守卫：

| Layer | 行为 | 目的 |
|---|---|---|
| 1 | 翻译结果整体是合法 magnet（`/^magnet:\?xt=urn:btih:[a-fA-F0-9]{32,40}$/i`）→ 原样返回 | 避免「60 字百家姓拼出真 magnet」被截断逻辑误伤 |
| 2 | 翻译结果是 http(s) URL → 原样返回 | 让用户自判安全性 |
| 3 | 翻译结果是 ed2k URL → 原样返回 | 对齐油猴原作语义 |
| 4 | 截到第一个非 hex 字符 | 避免「hex + 伪 magnet 头」被拼成可疑链接 |
| 5 | `toMagnet` 弱校验 32–40 hex | 挡住明显非 magnet 噪声 |
| 6 | `content/bjx.ts` `collectHits` 守卫：href 必须是 `magnet:` / `http(s)://` / `ed2k://` 之一才入 hits | 否则不挂结果行 |

结果行最终形态：每个 hit 旁挂 `🔍 预览` 按钮（magnet 命中），点击后通过 whatslink 验证资源真实性。

## 改任何识别 / 转换逻辑前的检查清单

- [ ] 新增的「识别类型」是否走了直通层？还是被截断吞掉了？
- [ ] 截断逻辑会不会把「60 字百家姓拼出真 magnet」这种合法情况误伤？
- [ ] 新增的格式是否需要挂预览按钮？预览按钮是不是只对 magnet 挂？
- [ ] `content/bjx.ts` 的 `collectHits` 守卫正则是否覆盖了新增格式？

## 反面教材（历史 bug）

- ❌ 把「`http://` 直通」删了，结果 `http://example.com/foo` 被截到 `:`，变成无效 hex → 漏挂
- ❌ 把 Layer 6 守卫放宽到「任何包含 hex 子串的 href」，结果评论里偶然的 `0x1234abcd...` 被挂成 magnet → 误挂
- ❌ 在识别阶段就过滤「明显是钓鱼的域名」→ 用户看不到完整 URL，没法自判安全 → 违反直通优于截断